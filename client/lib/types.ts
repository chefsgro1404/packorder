export interface ProductVariant {
  id: string;
  sku: string;
  barcode: string | null;
  price: string;
  title: string;
  product: {
    id: string;
    title: string;
    featuredImage: {
      url: string;
      altText: string | null;
    } | null;
  };
  inventoryQuantity: number;
}

export interface CartItem {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  price: string;
  quantity: number;
  imageUrl?: string;
}

export interface CartState {
  items: CartItem[];
  draftOrderId: string | null;
  total: string;
}

export interface OrderLineItem {
  id: string;
  name: string;
  quantity: number;
  variant: {
    id: string;
    sku: string;
  } | null;
}

export interface FulfillmentOrderLineItem {
  id: string;
  remainingQuantity: number;
}

export interface FulfillmentOrder {
  id: string;
  status: string;
  lineItems: {
    edges: Array<{
      node: FulfillmentOrderLineItem;
    }>;
  };
}

export interface ShippingAddress {
  name: string;
  address1: string;
  city: string;
  provinceCode: string;
  zip: string;
}

export interface Order {
  id: string;
  name: string;
  displayFulfillmentStatus: string;
  tags: string[];
  lineItems: {
    edges: Array<{
      node: OrderLineItem;
    }>;
  };
  metafield: {
    value: string;
  } | null;
  trackingCarrier: {
    value: string;
  } | null;
  trackingUrl: {
    value: string;
  } | null;
  shippingAddress: ShippingAddress | null;
  fulfillmentOrders: {
    edges: Array<{
      node: FulfillmentOrder;
    }>;
  };
}

export interface DraftOrderLineItem {
  id: string;
  title: string;
  quantity: number;
  variant: {
    id: string;
    price: string;
  } | null;
}

export interface DraftOrder {
  id: string;
  name: string;
  totalPrice: string;
  lineItems: {
    edges: Array<{
      node: DraftOrderLineItem;
    }>;
  };
}

export interface CachedVariant {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  barcode: string | null;
  vendor: string;
  tags: string[];
  imageUrl: string | null;
  price: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
}

export interface CachedOrderLineItem {
  id: string;
  name: string;
  quantity: number;
  variantId: string | null;
  sku: string | null;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
  price: string;
}

export interface CachedOrder {
  orderId: string;
  orderName: string;
  status: string;
  tags: string[];
  createdAt: string;
  lineItems: CachedOrderLineItem[];
}

export interface BarcodeSearchResult {
  orders: CachedOrder[];
  plu: string | null;
  weightGrams: number | null;
  isVariableWeight: boolean;
  matchedProduct: {
    productTitle: string;
    variantTitle: string;
    sku: string | null;
    imageUrl: string | null;
  } | null;
}

export interface VariantSearchResult {
  id: string;
  sku: string;
  barcode: string | null;
  title: string;
  product: {
    id: string;
    title: string;
    featuredImage: {
      url: string;
      altText: string | null;
    } | null;
  };
}

export interface ShipmentLineItem {
  fulfillmentLineItemId: string;
  lineItemId: string;
  name: string;
  quantityExpected: number;
  quantityShipped: number;
  variantId: string | null;
  sku: string | null;
  barcode: string | null;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
  price: string;
}

export interface ShipmentFulfillment {
  fulfillmentId: string;
  trackingNumber: string;
  trackingCarrier: string | null;
  trackingUrl: string | null;
  orderName: string;
  orderId: string;
  orderTags: string[];
  orderCreatedAt: string;
  customerName: string | null;
  customerEmail: string | null;
  shippingAddress: ShippingAddress | null;
  shopifyFulfillmentStatus: string;
  status: "pending" | "partial" | "shipped";
  fulfillmentCreatedAt: string;
  lineItems: ShipmentLineItem[];
  shippedAt: string | null;
  completedBy: string | null;
  isManualComplete: boolean;
  manualReason: string | null;
}

export interface ShipmentScanRecord {
  orderId: string;
  orderName: string;
  fulfillmentId: string;
  trackingNumber: string;
  fulfillmentLineItemId: string | null;
  lineItemId: string | null;
  variantId: string | null;
  sku: string | null;
  barcode: string | null;
  plu: string | null;
  productTitle: string | null;
  variantTitle: string | null;
  quantityShipped: number;
  weightGrams: number | null;
  pricePerLb: number | null;
  totalPriceScanned: number | null;
  isVariableWeight: boolean;
  scannedBy: string;
  scannedAt: string;
  isManualLineItem: boolean;
  isManualOverride: boolean;
  overrideReason: string | null;
}
