import { Prisma } from "@prisma/client";

/** Inspect catalog metadata only, never customer/catalog/financial rows. The
 * migration record alone cannot detect a dropped or unvalidated protection. */
export const databaseInvariantGuard = Prisma.sql`(
 NOT EXISTS (
  SELECT 1 FROM (VALUES
   ('User','User_role_domain'),('User','User_seller_status_domain'),
   ('Product','Product_status_domain'),('Product','Product_price_positive'),
   ('Product','Product_discount_price_valid'),('Product','Product_stock_nonnegative'),
   ('Order','Order_status_domain'),('Order','Order_payment_method_domain'),
   ('Order','Order_payment_status_domain'),('Order','Order_total_nonnegative'),('Order','Order_tracking_code_valid'),
   ('OrderItem','OrderItem_quantity_positive'),('OrderItem','OrderItem_price_nonnegative')
  ) AS required(relation,name)
  WHERE NOT EXISTS (
   SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass(format('public.%I',required.relation))
    AND c.conname=required.name AND c.contype='c' AND c.convalidated
  )
 ) AND NOT EXISTS (
  SELECT 1 FROM (VALUES
   ('Order','Order_trackingNumber_key','trackingNumber',NULL::text),
   ('Address','Address_one_default_per_user','userId','"isDefault"=true'),
   ('Review','Review_one_canonical_user_product','userId,productId','"isCanonical"')
  ) AS required(relation,name,columns,predicate)
  WHERE NOT EXISTS (
   SELECT 1 FROM pg_index i JOIN pg_class index_relation ON index_relation.oid=i.indexrelid
   WHERE i.indrelid=to_regclass(format('public.%I',required.relation)) AND index_relation.relname=required.name
    AND i.indisunique AND i.indisvalid AND i.indisready AND NOT i.indnullsnotdistinct
    AND i.indexprs IS NULL AND i.indnkeyatts=array_length(string_to_array(required.columns,','),1)
    AND (SELECT string_agg(a.attname::text,',' ORDER BY key.ordinality)
     FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(number,ordinality)
     JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=key.number WHERE key.ordinality<=i.indnkeyatts)=required.columns
    AND ((required.predicate IS NULL AND i.indpred IS NULL) OR
     regexp_replace(pg_get_expr(i.indpred,i.indrelid),'[[:space:]()]','','g')=required.predicate)
  )
 )
)`;
