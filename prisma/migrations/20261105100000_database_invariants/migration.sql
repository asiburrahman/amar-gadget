BEGIN;
SET LOCAL lock_timeout='5000ms';
SET LOCAL statement_timeout='60000ms';
-- Drain writers for the reviewed maintenance window. Keep the preflight and
-- validation on one stable dataset; do not repair account or financial history.
LOCK TABLE "User","Product","Order","OrderItem" IN SHARE ROW EXCLUSIVE MODE;

-- The read-only operator command extracts this exact SELECT body, so a blocked
-- upgrade can be investigated without installing a function or changing data.
CREATE FUNCTION marketplace_invariant_counts() RETURNS TABLE(rule text,violations bigint)
LANGUAGE sql STABLE AS $audit_preflight$
 WITH users AS (
  SELECT count(*) FILTER(WHERE role NOT IN ('USER','MEMBER','ADMIN')) AS role,
   count(*) FILTER(WHERE "sellerStatus" NOT IN ('APPROVED','PENDING','BLOCKED','REJECTED')) AS seller_status FROM "User"
 ),products AS (
  SELECT count(*) FILTER(WHERE status NOT IN ('PENDING_APPROVAL','APPROVED','REJECTED','ARCHIVED')) AS status,
   count(*) FILTER(WHERE NOT(price BETWEEN 0.01 AND 99999999.99)) AS price,
   count(*) FILTER(WHERE "discountPrice" IS NOT NULL AND NOT("discountPrice">=0.01 AND "discountPrice"<price)) AS discount_price,
   count(*) FILTER(WHERE stock<0) AS stock FROM "Product"
 ),orders AS (
  SELECT count(*) FILTER(WHERE status NOT IN ('PENDING','PROCESSING','PARTIALLY_SHIPPED','SHIPPED','PARTIALLY_DELIVERED','DELIVERED','CANCELLED')) AS status,
   count(*) FILTER(WHERE "paymentMethod" NOT IN ('COD','STRIPE')) AS payment_method,
   count(*) FILTER(WHERE "paymentStatus" NOT IN ('UNPAID','PAID','FAILED')) AS payment_status,
   count(*) FILTER(WHERE NOT(total BETWEEN 0 AND 99999999.99)) AS total,
   count(*) FILTER(WHERE "trackingNumber" IS NOT NULL AND
    NOT(char_length("trackingNumber") BETWEEN 1 AND 120 AND "trackingNumber"=btrim("trackingNumber") AND "trackingNumber" !~ '[[:cntrl:]]')) AS tracking_code
  FROM "Order"
 ),items AS (
  SELECT count(*) FILTER(WHERE quantity<=0) AS quantity,
   count(*) FILTER(WHERE NOT(price BETWEEN 0 AND 99999999.99)) AS price FROM "OrderItem"
 ),duplicate_tracking AS (
  SELECT COALESCE(sum(occurrences),0)::bigint AS affected_rows FROM (
   SELECT count(*) AS occurrences FROM "Order" WHERE "trackingNumber" IS NOT NULL GROUP BY "trackingNumber" HAVING count(*)>1
  ) duplicates
 )
 SELECT 'User.role'::text AS rule,role AS violations FROM users UNION ALL SELECT 'User.sellerStatus',seller_status FROM users
 UNION ALL SELECT 'Product.status',status FROM products UNION ALL SELECT 'Product.price',price FROM products
 UNION ALL SELECT 'Product.discountPrice',discount_price FROM products UNION ALL SELECT 'Product.stock',stock FROM products
 UNION ALL SELECT 'Order.status',status FROM orders UNION ALL SELECT 'Order.paymentMethod',payment_method FROM orders
 UNION ALL SELECT 'Order.paymentStatus',payment_status FROM orders UNION ALL SELECT 'Order.total',total FROM orders
 UNION ALL SELECT 'Order.trackingNumber',tracking_code FROM orders UNION ALL SELECT 'Order.trackingDuplicates',affected_rows FROM duplicate_tracking
 UNION ALL SELECT 'OrderItem.quantity',quantity FROM items UNION ALL SELECT 'OrderItem.price',price FROM items
$audit_preflight$;

DO $$
DECLARE invalid jsonb;
BEGIN
 SELECT jsonb_object_agg(rule,violations ORDER BY rule) INTO invalid FROM marketplace_invariant_counts() WHERE violations>0;
 IF invalid IS NOT NULL THEN
  RAISE EXCEPTION 'Database invariant preflight failed; affected-row counts: %. No records were repaired. Run the read-only preflight and reconcile privately before retrying.',invalid USING ERRCODE='23514';
 END IF;
END $$;

ALTER TABLE "User"
 ADD CONSTRAINT "User_role_domain" CHECK(role IN ('USER','MEMBER','ADMIN')),
 ADD CONSTRAINT "User_seller_status_domain" CHECK("sellerStatus" IN ('APPROVED','PENDING','BLOCKED','REJECTED'));
ALTER TABLE "Product"
 ADD CONSTRAINT "Product_status_domain" CHECK(status IN ('PENDING_APPROVAL','APPROVED','REJECTED','ARCHIVED')),
 ADD CONSTRAINT "Product_price_positive" CHECK(price BETWEEN 0.01 AND 99999999.99),
 ADD CONSTRAINT "Product_discount_price_valid" CHECK("discountPrice" IS NULL OR ("discountPrice">=0.01 AND "discountPrice"<price)),
 ADD CONSTRAINT "Product_stock_nonnegative" CHECK(stock>=0);
ALTER TABLE "Order"
 ADD CONSTRAINT "Order_status_domain" CHECK(status IN ('PENDING','PROCESSING','PARTIALLY_SHIPPED','SHIPPED','PARTIALLY_DELIVERED','DELIVERED','CANCELLED')),
 ADD CONSTRAINT "Order_payment_method_domain" CHECK("paymentMethod" IN ('COD','STRIPE')),
 ADD CONSTRAINT "Order_payment_status_domain" CHECK("paymentStatus" IN ('UNPAID','PAID','FAILED')),
 ADD CONSTRAINT "Order_total_nonnegative" CHECK(total BETWEEN 0 AND 99999999.99),
 ADD CONSTRAINT "Order_tracking_code_valid" CHECK("trackingNumber" IS NULL OR
  (char_length("trackingNumber") BETWEEN 1 AND 120 AND "trackingNumber"=btrim("trackingNumber") AND "trackingNumber" !~ '[[:cntrl:]]'));
ALTER TABLE "OrderItem"
 ADD CONSTRAINT "OrderItem_quantity_positive" CHECK(quantity>0),
 ADD CONSTRAINT "OrderItem_price_nonnegative" CHECK(price BETWEEN 0 AND 99999999.99);

-- Null tracking codes remain valid for retained legacy orders. Existing codes,
-- order IDs, amounts, history, timestamps and review/default flags are unchanged.
CREATE UNIQUE INDEX "Order_trackingNumber_key" ON "Order"("trackingNumber");

-- Measured against the actual public catalog join/filter/sort query shapes.
-- The full category/brand indexes also serve their restrictive FK lookups.
CREATE INDEX "Product_category_status_created_id_idx" ON "Product"("categoryId",status,"createdAt" DESC,id);
CREATE INDEX "Product_brand_status_created_id_idx" ON "Product"("brandId",status,"createdAt" DESC,id);
CREATE INDEX "Product_public_latest_idx" ON "Product"("createdAt" DESC,id) WHERE status='APPROVED';
CREATE INDEX "Product_public_effective_price_idx" ON "Product"((COALESCE("discountPrice",price)),"createdAt" DESC,id) WHERE status='APPROVED';
CREATE INDEX "Product_public_rating_idx" ON "Product"(rating DESC,"reviewCount" DESC,"createdAt" DESC,id) WHERE status='APPROVED';
-- Restrictive Product deletion checks must find saved wishlist references
-- without scanning every customer's wishlist. Owner pagination stays separate.
CREATE INDEX "Wishlist_productId_idx" ON "Wishlist"("productId");
COMMIT;
