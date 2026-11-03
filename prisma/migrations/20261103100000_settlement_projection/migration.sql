BEGIN;
-- A shared exact-paisa allocator. Its JSON values are decimal strings so no
-- consumer can silently round aggregate money through a JavaScript float.
CREATE FUNCTION seller_settlement_allocate(amount NUMERIC, weights JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE denominator NUMERIC; result JSONB;
BEGIN
 IF amount IS NULL OR amount<0 OR trunc(amount)<>amount OR weights IS NULL OR jsonb_typeof(weights)<>'object' OR weights='{}'::jsonb THEN
  RAISE EXCEPTION 'Invalid settlement allocation' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(weights) WHERE key !~ '^[A-Za-z0-9:_-]{1,160}$' OR value !~ '^[0-9]+$') THEN
  RAISE EXCEPTION 'Invalid settlement weights' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(sum(value::numeric),0) INTO denominator FROM jsonb_each_text(weights);
 IF denominator=0 AND amount<>0 THEN RAISE EXCEPTION 'Positive settlement allocation needs positive weights' USING ERRCODE='23514'; END IF;
 WITH parts AS (
  SELECT key,CASE WHEN denominator>0 THEN div(amount*value::numeric,denominator) ELSE 0 END AS base,
   CASE WHEN denominator>0 THEN mod(amount*value::numeric,denominator) ELSE 0 END AS remainder FROM jsonb_each_text(weights)
 ), ranked AS (SELECT *,row_number() OVER(ORDER BY remainder DESC,key COLLATE "C") AS rank,
  amount-sum(base) OVER() AS leftover FROM parts)
 SELECT COALESCE(jsonb_object_agg(key,(base+CASE WHEN rank<=leftover THEN 1 ELSE 0 END)::text),'{}'::jsonb) INTO result FROM ranked;
 RETURN result;
END $$;

CREATE FUNCTION seller_settlement_projection(target TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE parent "Order"%ROWTYPE; shipment JSONB; source JSONB; weights JSONB; originals JSONB; remaining JSONB; components JSONB; losses JSONB;
 known BOOLEAN; goods_total NUMERIC; net_total NUMERIC; retained_total NUMERIC; loss NUMERIC; shipping NUMERIC; goods NUMERIC; fee NUMERIC; potential NUMERIC;
 original_fee NUMERIC; retained_fee NUMERIC; holds TEXT[]; results JSONB:='[]'::jsonb;
BEGIN
 SELECT * INTO parent FROM "Order" WHERE id=target;
 IF NOT FOUND THEN RETURN jsonb_build_object('shipments','[]'::jsonb,'unallocatedDisputeLossCents','0'); END IF;
 IF parent.status NOT IN ('PENDING','PROCESSING','SHIPPED','DELIVERED','CANCELLED') OR parent."paymentMethod" NOT IN ('COD','STRIPE')
  OR parent."paymentStatus" NOT IN ('UNPAID','PAID','FAILED') OR parent."refundState" NOT IN ('NONE','PENDING','PARTIAL','REFUNDED','REVIEW')
  OR parent."disputeStatus" NOT IN ('NONE','ACTIVE','WON','LOST') THEN
  RAISE EXCEPTION 'Unknown financial state needs reconciliation' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id,'sellerId',f."sellerId",'status',f.status,'codCollected',f."codCollected",
  'grossCents',trunc(lines.gross)::text,'netCents',lines.net::text,'retainedCents',lines.retained::text,
  'commissionBps',p."commissionBps",'shippingRecipient',p."shippingRecipient") ORDER BY f.id COLLATE "C"),'[]'::jsonb)
 INTO source FROM "OrderFulfillment" f
 JOIN LATERAL (SELECT sum((i.price*i.quantity*100)::numeric) AS gross,
   CASE WHEN count(*) FILTER(WHERE i."netCents" IS NULL)=0 THEN sum(i."netCents") END AS net,
   CASE WHEN count(*) FILTER(WHERE i."retainedCents" IS NULL)=0 THEN sum(i."retainedCents") END AS retained
  FROM "OrderItem" i WHERE i."fulfillmentId"=f.id HAVING count(*)>0) lines ON true
 LEFT JOIN "SellerSettlementSnapshot" s ON s."fulfillmentId"=f.id AND s."sellerId"=f."sellerId" AND s."orderId"=f."orderId"
 LEFT JOIN "SellerSettlementPolicy" p ON p.id=s."policyId" WHERE f."orderId"=target;
 IF jsonb_array_length(source)=0 THEN RETURN jsonb_build_object('shipments','[]'::jsonb,'unallocatedDisputeLossCents',parent."disputeAmountCents"::text); END IF;
 goods_total:=parent."subtotalCents"-parent."discountCents";
 known:=goods_total IS NOT NULL AND parent."shippingCents" IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source) r WHERE r->>'netCents' IS NULL OR r->>'retainedCents' IS NULL);
 SELECT sum((r->>'netCents')::numeric) INTO net_total FROM jsonb_array_elements(source) r;
 IF known AND net_total<>goods_total THEN RAISE EXCEPTION 'Shipment pricing does not reconcile' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(source) r WHERE (r->>'grossCents')::numeric<0
  OR (r->>'netCents')::numeric>(r->>'grossCents')::numeric OR (r->>'retainedCents')::numeric<0
  OR (r->>'retainedCents')::numeric>(r->>'netCents')::numeric) THEN
  RAISE EXCEPTION 'Invalid captured shipment money' USING ERRCODE='23514';
 END IF;
 IF parent."shippingRefundedCents"<0 OR parent."disputeAmountCents"<0 OR (parent."shippingCents" IS NOT NULL AND parent."shippingRefundedCents">parent."shippingCents") THEN
  RAISE EXCEPTION 'Invalid captured shipping or provider loss' USING ERRCODE='23514';
 END IF;
 SELECT jsonb_object_agg(r->>'id',CASE WHEN known AND goods_total>0 THEN r->>'netCents' ELSE r->>'grossCents' END) INTO weights FROM jsonb_array_elements(source) r;
 originals:=seller_settlement_allocate(CASE WHEN known THEN parent."shippingCents" ELSE 0 END,weights);
 remaining:=seller_settlement_allocate(CASE WHEN known THEN parent."shippingCents"-parent."shippingRefundedCents" ELSE 0 END,originals);
 SELECT jsonb_object_agg(key,value) INTO components FROM (
  SELECT (r->>'id')||':GOODS' AS key,CASE WHEN known THEN r->>'retainedCents' ELSE '0' END AS value FROM jsonb_array_elements(source) r
  UNION ALL SELECT (r->>'id')||':SHIPPING',remaining->>(r->>'id') FROM jsonb_array_elements(source) r) c;
 SELECT COALESCE(sum(value::numeric),0) INTO retained_total FROM jsonb_each_text(components);
 loss:=LEAST(parent."disputeAmountCents",retained_total); losses:=seller_settlement_allocate(loss,components);
 FOR shipment IN SELECT * FROM jsonb_array_elements(source) LOOP
  goods:=CASE WHEN known THEN (shipment->>'retainedCents')::numeric ELSE 0 END-(losses->>(shipment->>'id'||':GOODS'))::numeric;
  shipping:=(remaining->>(shipment->>'id'))::numeric-(losses->>(shipment->>'id'||':SHIPPING'))::numeric;
  fee:=CASE WHEN shipment->>'commissionBps' IS NOT NULL THEN div(goods*(shipment->>'commissionBps')::numeric+5000,10000) ELSE 0 END;
  potential:=CASE WHEN shipment->>'commissionBps' IS NOT NULL THEN goods-fee+CASE WHEN shipment->>'shippingRecipient'='SELLER' THEN shipping ELSE 0 END ELSE 0 END;
  holds:=ARRAY[]::text[];
  IF shipment->>'commissionBps' IS NULL THEN holds:=array_append(holds,'POLICY_REQUIRED'); END IF;
  IF NOT known THEN holds:=array_append(holds,'PRICING_REQUIRED'); END IF;
  IF parent."financialReviewReason" IS NOT NULL OR parent."reservationReviewReason" IS NOT NULL OR parent."refundState"='REVIEW' THEN holds:=array_append(holds,'FINANCIAL_REVIEW'); END IF;
  IF parent."refundState"='PENDING' THEN holds:=array_append(holds,'REFUND_PENDING'); END IF;
  IF parent."disputeStatus"='ACTIVE' THEN holds:=array_append(holds,'DISPUTE_ACTIVE'); END IF;
  IF parent.status='CANCELLED' OR shipment->>'status'='CANCELLED' THEN holds:=array_append(holds,'CANCELLED');
  ELSIF shipment->>'status'<>'DELIVERED' THEN holds:=array_append(holds,'DELIVERY_REQUIRED'); END IF;
  IF NOT (CASE WHEN parent."paymentMethod"='COD' THEN (shipment->>'codCollected')::boolean ELSE parent."paymentStatus"='PAID' END) THEN holds:=array_append(holds,'COLLECTION_REQUIRED'); END IF;
  original_fee:=(originals->>(shipment->>'id'))::numeric; retained_fee:=(losses->>(shipment->>'id'||':GOODS'))::numeric+(losses->>(shipment->>'id'||':SHIPPING'))::numeric;
  results:=results||jsonb_build_array(jsonb_build_object('id',shipment->>'id','sellerId',shipment->>'sellerId',
   'originalShippingCents',original_fee::text,'goodsCents',goods::text,'shippingCents',shipping::text,
   'disputeLossCents',retained_fee::text,'commissionCents',fee::text,'potentialCents',potential::text,
   'availableCents',(CASE WHEN cardinality(holds)=0 THEN potential ELSE 0 END)::text,'holds',to_jsonb(holds)));
 END LOOP;
 RETURN jsonb_build_object('shipments',results,'unallocatedDisputeLossCents',(parent."disputeAmountCents"-loss)::text);
END $$;
COMMIT;
