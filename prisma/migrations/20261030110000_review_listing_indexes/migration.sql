CREATE INDEX "Product_sellerId_id_idx" ON "Product"("sellerId",id);
CREATE INDEX "OrderItem_orderId_productId_idx" ON "OrderItem"("orderId","productId");
