using Newtonsoft.Json;
using Azure.Data.Tables;
using Azure;

namespace ShipScan.Functions.Models;

// ─── Auth ────────────────────────────────────────────────────────────────────

public class LoginRequest
{
    [JsonProperty("email")]
    public string? Email { get; set; }

    [JsonProperty("password")]
    public string? Password { get; set; }
}

public class AuthResponse
{
    [JsonProperty("token")]
    public string Token { get; set; } = "";
}

// ─── Shopify: Product Lookup ──────────────────────────────────────────────────

public class ProductVariant
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("sku")]
    public string? Sku { get; set; }

    [JsonProperty("barcode")]
    public string? Barcode { get; set; }

    [JsonProperty("price")]
    public string Price { get; set; } = "0.00";

    [JsonProperty("title")]
    public string Title { get; set; } = "";

    [JsonProperty("inventoryQuantity")]
    public int InventoryQuantity { get; set; }

    [JsonProperty("product")]
    public ProductInfo Product { get; set; } = new();

    [JsonProperty("inventoryItem")]
    public InventoryItemInfo? InventoryItem { get; set; }

    [JsonIgnore]
    public double? Weight => InventoryItem?.Measurement?.Weight?.Value;

    [JsonIgnore]
    public string? WeightUnit => InventoryItem?.Measurement?.Weight?.Unit;
}

public class InventoryItemInfo
{
    [JsonProperty("measurement")]
    public InventoryMeasurement? Measurement { get; set; }
}

public class InventoryMeasurement
{
    [JsonProperty("weight")]
    public InventoryWeight? Weight { get; set; }
}

public class InventoryWeight
{
    [JsonProperty("value")]
    public double Value { get; set; }

    [JsonProperty("unit")]
    public string Unit { get; set; } = "";
}

public class ProductInfo
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("title")]
    public string Title { get; set; } = "";

    [JsonProperty("featuredImage")]
    public ProductImage? FeaturedImage { get; set; }
}

public class ProductImage
{
    [JsonProperty("url")]
    public string Url { get; set; } = "";

    [JsonProperty("altText")]
    public string? AltText { get; set; }
}

// ─── Shopify: Order ──────────────────────────────────────────────────────────

public class ShopifyOrder
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("name")]
    public string Name { get; set; } = "";

    [JsonProperty("displayFulfillmentStatus")]
    public string DisplayFulfillmentStatus { get; set; } = "";

    [JsonProperty("tags")]
    public List<string> Tags { get; set; } = new();

    [JsonProperty("lineItems")]
    public EdgeList<OrderLineItem> LineItems { get; set; } = new();

    [JsonProperty("metafield")]
    public MetafieldValue? TrackingNumber { get; set; }

    [JsonProperty("trackingCarrier")]
    public MetafieldValue? TrackingCarrier { get; set; }

    [JsonProperty("trackingUrl")]
    public MetafieldValue? TrackingUrl { get; set; }

    [JsonProperty("shippingAddress")]
    public ShippingAddress? ShippingAddress { get; set; }

    [JsonProperty("fulfillmentOrders")]
    public EdgeList<FulfillmentOrder> FulfillmentOrders { get; set; } = new();
}

public class MetafieldValue
{
    [JsonProperty("value")]
    public string Value { get; set; } = "";
}

public class OrderLineItem
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("name")]
    public string Name { get; set; } = "";

    [JsonProperty("quantity")]
    public int Quantity { get; set; }

    [JsonProperty("variant")]
    public VariantRef? Variant { get; set; }
}

public class VariantRef
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("sku")]
    public string? Sku { get; set; }
}

public class FulfillmentOrder
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("status")]
    public string Status { get; set; } = "";

    [JsonProperty("lineItems")]
    public EdgeList<FulfillmentOrderLineItem> LineItems { get; set; } = new();
}

public class FulfillmentOrderLineItem
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("remainingQuantity")]
    public int RemainingQuantity { get; set; }
}

public class ShippingAddress
{
    [JsonProperty("name")]
    public string Name { get; set; } = "";

    [JsonProperty("address1")]
    public string Address1 { get; set; } = "";

    [JsonProperty("city")]
    public string City { get; set; } = "";

    [JsonProperty("provinceCode")]
    public string ProvinceCode { get; set; } = "";

    [JsonProperty("zip")]
    public string Zip { get; set; } = "";
}

// ─── Shopify: Draft Order ────────────────────────────────────────────────────

public class DraftOrderLineItemInput
{
    [JsonProperty("variantId")]
    public string VariantId { get; set; } = "";

    [JsonProperty("quantity")]
    public int Quantity { get; set; }
}

public class CreateDraftOrderRequest
{
    [JsonProperty("variantId")]
    public string? VariantId { get; set; }

    [JsonProperty("quantity")]
    public int Quantity { get; set; } = 1;
}

public class UpdateDraftOrderRequest
{
    [JsonProperty("draftOrderId")]
    public string? DraftOrderId { get; set; }

    [JsonProperty("lineItems")]
    public List<DraftOrderLineItemInput> LineItems { get; set; } = new();
}

public class DraftOrderActionRequest
{
    [JsonProperty("action")]
    public string Action { get; set; } = "";

    [JsonProperty("draftOrderId")]
    public string? DraftOrderId { get; set; }

    [JsonProperty("variantId")]
    public string? VariantId { get; set; }

    [JsonProperty("quantity")]
    public int Quantity { get; set; } = 1;

    [JsonProperty("lineItems")]
    public List<DraftOrderLineItemInput>? LineItems { get; set; }
}

public class DraftOrder
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("name")]
    public string Name { get; set; } = "";

    [JsonProperty("totalPrice")]
    public string TotalPrice { get; set; } = "0.00";

    [JsonProperty("lineItems")]
    public EdgeList<DraftOrderLineItem> LineItems { get; set; } = new();
}

public class DraftOrderLineItem
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("title")]
    public string Title { get; set; } = "";

    [JsonProperty("quantity")]
    public int Quantity { get; set; }

    [JsonProperty("variant")]
    public DraftOrderVariantRef? Variant { get; set; }
}

public class DraftOrderVariantRef
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("price")]
    public string Price { get; set; } = "0.00";
}

// ─── Shopify: Fulfill ────────────────────────────────────────────────────────

public class FulfillRequest
{
    [JsonProperty("orderId")]     public string? OrderId { get; set; }
    [JsonProperty("barcode")]     public string? ScannedBarcode { get; set; }
    [JsonProperty("weightGrams")] public double? WeightGrams { get; set; }
}

// ─── Shopify: Variant Search/Update ─────────────────────────────────────────

public class VariantSearchResult
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";

    [JsonProperty("sku")]
    public string? Sku { get; set; }

    [JsonProperty("barcode")]
    public string? Barcode { get; set; }

    [JsonProperty("title")]
    public string Title { get; set; } = "";

    [JsonProperty("product")]
    public ProductInfo Product { get; set; } = new();
}

public class UpdateBarcodeRequest
{
    [JsonProperty("productId")]
    public string? ProductId { get; set; }

    [JsonProperty("variantId")]
    public string? VariantId { get; set; }

    [JsonProperty("barcode")]
    public string? Barcode { get; set; }
}

public class BarcodeAuditEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "barcode";
    public string RowKey { get; set; } = "";       // ticks-guid, sortable
    public string ProductId { get; set; } = "";    // full GID
    public string VariantId { get; set; } = "";    // full GID
    public string ProductTitle { get; set; } = "";
    public string? VariantTitle { get; set; }
    public string? Sku { get; set; }
    public string? OldBarcode { get; set; }
    public string NewBarcode { get; set; } = "";
    public string Action { get; set; } = "";       // added | changed | removed | rescanned
    public string? AssignedBy { get; set; }
    public DateTimeOffset AssignedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

// ─── GraphQL helpers ─────────────────────────────────────────────────────────

public class EdgeList<T>
{
    [JsonProperty("edges")]
    public List<Edge<T>> Edges { get; set; } = new();
}

public class Edge<T>
{
    [JsonProperty("node")]
    public T Node { get; set; } = default!;
}

public class GraphQlUserError
{
    [JsonProperty("field")]
    public List<string>? Field { get; set; }

    [JsonProperty("message")]
    public string Message { get; set; } = "";
}

// ─── Auth ────────────────────────────────────────────────────────────────────

public class RefreshRequest
{
    // Body intentionally empty — refresh token is read from httpOnly cookie
}

// ─── Product Sync ────────────────────────────────────────────────────────────

public class ProductVariantEntity : ITableEntity
{
    public string PartitionKey { get; set; } = ""; // numeric product ID
    public string RowKey { get; set; } = "";       // numeric variant ID
    public string ProductId { get; set; } = "";    // full GID
    public string VariantId { get; set; } = "";    // full GID
    public string ProductTitle { get; set; } = "";
    public string VariantTitle { get; set; } = "";
    public string? Sku { get; set; }
    public string? Barcode { get; set; }
    public string Vendor { get; set; } = "";
    public string Tags { get; set; } = "[]";       // JSON-encoded string array
    public string Collections { get; set; } = "[]"; // JSON-encoded string array of collection titles
    public string? ImageUrl { get; set; }
    public string Price { get; set; } = "0.00";
    public string Status { get; set; } = "ACTIVE"; // ACTIVE | DRAFT | ARCHIVED
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class SyncSettingsEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "settings";
    public string RowKey { get; set; } = "lastsync";
    public DateTimeOffset LastSyncedAt { get; set; }
    public string Vendors { get; set; } = "";
    public string Tags { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class SyncRequest
{
    [JsonProperty("vendors")]
    public List<string>? Vendors { get; set; }

    [JsonProperty("tags")]
    public List<string>? Tags { get; set; }
}

// Webhook REST payload models (Shopify sends numeric IDs, snake_case)
public class WebhookProduct
{
    [JsonProperty("id")]      public long Id { get; set; }
    [JsonProperty("title")]   public string Title { get; set; } = "";
    [JsonProperty("vendor")]  public string Vendor { get; set; } = "";
    [JsonProperty("tags")]    public string Tags { get; set; } = ""; // comma-separated
    [JsonProperty("images")]  public List<WebhookImage>? Images { get; set; }
    [JsonProperty("variants")] public List<WebhookVariant> Variants { get; set; } = new();
}

public class WebhookVariant
{
    [JsonProperty("id")]      public long Id { get; set; }
    [JsonProperty("sku")]     public string? Sku { get; set; }
    [JsonProperty("barcode")] public string? Barcode { get; set; }
    [JsonProperty("title")]   public string Title { get; set; } = "";
    [JsonProperty("price")]   public string Price { get; set; } = "0.00";
}

public class WebhookImage
{
    [JsonProperty("src")] public string Src { get; set; } = "";
}

public class WebhookDeletePayload
{
    [JsonProperty("id")] public long Id { get; set; }
}

// Webhook order payload (REST format)
public class WebhookOrder
{
    [JsonProperty("id")]                 public long Id { get; set; }
    [JsonProperty("name")]               public string Name { get; set; } = "";
    [JsonProperty("fulfillment_status")] public string? FulfillmentStatus { get; set; } // null = unfulfilled
    [JsonProperty("tags")]               public string Tags { get; set; } = "";
    [JsonProperty("created_at")]         public string CreatedAt { get; set; } = "";
    [JsonProperty("line_items")]         public List<WebhookOrderLineItem> LineItems { get; set; } = new();
}

public class WebhookOrderLineItem
{
    [JsonProperty("id")]            public long Id { get; set; }
    [JsonProperty("name")]          public string Name { get; set; } = "";
    [JsonProperty("title")]         public string Title { get; set; } = "";
    [JsonProperty("variant_title")] public string? VariantTitle { get; set; }
    [JsonProperty("quantity")]      public int Quantity { get; set; }
    [JsonProperty("price")]         public string Price { get; set; } = "0.00";
    [JsonProperty("sku")]           public string? Sku { get; set; }
    [JsonProperty("variant_id")]    public long? VariantId { get; set; }
}

// Cached line item stored inside UnfulfilledOrderEntity.LineItemsJson
public class OrderLineItemCache
{
    [JsonProperty("id")]           public string Id { get; set; } = "";
    [JsonProperty("name")]         public string Name { get; set; } = "";
    [JsonProperty("quantity")]     public int Quantity { get; set; }
    [JsonProperty("variantId")]    public string? VariantId { get; set; }
    [JsonProperty("sku")]          public string? Sku { get; set; }
    [JsonProperty("productTitle")] public string ProductTitle { get; set; } = "";
    [JsonProperty("variantTitle")] public string? VariantTitle { get; set; }
    [JsonProperty("imageUrl")]     public string? ImageUrl { get; set; }
    [JsonProperty("price")]        public string Price { get; set; } = "0.00";
}

// Request models
public class ScanSearchRequest
{
    [JsonProperty("barcode")] public string Barcode { get; set; } = "";
}

// ─── Table Storage Entities ──────────────────────────────────────────────────

public class RevokedTokenEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "revoked";
    public string RowKey { get; set; } = "";      // JTI
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class UnfulfilledOrderEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "order";
    public string RowKey { get; set; } = "";       // numeric order ID
    public string OrderId { get; set; } = "";      // full GID
    public string OrderName { get; set; } = "";
    public string Status { get; set; } = "";
    public string Tags { get; set; } = "[]";
    public string LineItemsJson { get; set; } = "[]";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class ScanHistoryEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "scan";
    public string RowKey { get; set; } = "";
    public string Barcode { get; set; } = "";
    public string? Plu { get; set; }
    public double? WeightGrams { get; set; }
    public bool IsVariableWeight { get; set; }
    public string? MatchedVariantId { get; set; }
    public string? ProductTitle { get; set; }
    public string? VariantTitle { get; set; }
    public string? Price { get; set; }
    public string? OrderId { get; set; }
    public string? OrderName { get; set; }
    public DateTimeOffset ScannedAt { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class AuditLogEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "audit";
    public string RowKey { get; set; } = Guid.NewGuid().ToString();
    public string? Mode { get; set; }
    public string? Barcode { get; set; }
    public string? Result { get; set; }
    public DateTimeOffset ScanTime { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

// ─── Ship Mode ───────────────────────────────────────────────────────────────

public class FulfillmentShipmentEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "ship";
    public string RowKey { get; set; } = "";
    public string OrderId { get; set; } = "";
    public string OrderName { get; set; } = "";
    public string OrderTags { get; set; } = "[]";
    public string OrderCreatedAt { get; set; } = "";
    public string? CustomerName { get; set; }
    public string? CustomerEmail { get; set; }
    public string? ShippingAddressJson { get; set; }
    public string FulfillmentId { get; set; } = "";
    public string TrackingNumber { get; set; } = "";
    public string? TrackingCarrier { get; set; }
    public string? TrackingUrl { get; set; }
    public string ShopifyFulfillmentStatus { get; set; } = "";
    public string Status { get; set; } = "pending";
    public string LineItemsJson { get; set; } = "[]";
    public DateTimeOffset FulfillmentCreatedAt { get; set; }
    public DateTimeOffset? ShippedAt { get; set; }
    public string? CompletedBy { get; set; }
    public bool IsManualComplete { get; set; }
    public string? ManualReason { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class UpdateFulfillmentNotesRequest
{
    [JsonProperty("fulfillmentId")] public string FulfillmentId { get; set; } = "";
    [JsonProperty("notes")]         public string? Notes { get; set; }
}

public class ShipmentLineItemCache
{
    [JsonProperty("fulfillmentLineItemId")] public string FulfillmentLineItemId { get; set; } = "";
    [JsonProperty("lineItemId")]            public string LineItemId { get; set; } = "";
    [JsonProperty("name")]                  public string Name { get; set; } = "";
    [JsonProperty("quantityExpected")]      public int QuantityExpected { get; set; }
    [JsonProperty("quantityShipped")]       public int QuantityShipped { get; set; }
    [JsonProperty("variantId")]             public string? VariantId { get; set; }
    [JsonProperty("sku")]                   public string? Sku { get; set; }
    [JsonProperty("barcode")]               public string? Barcode { get; set; }
    [JsonProperty("productTitle")]          public string ProductTitle { get; set; } = "";
    [JsonProperty("variantTitle")]          public string? VariantTitle { get; set; }
    [JsonProperty("imageUrl")]              public string? ImageUrl { get; set; }
    [JsonProperty("price")]                 public string Price { get; set; } = "0.00";
    [JsonProperty("weight")]                public double? Weight { get; set; }
    [JsonProperty("weightUnit")]            public string? WeightUnit { get; set; }
    [JsonProperty("isExtra")]                public bool IsExtra { get; set; }
    [JsonProperty("addedReason")]           public string? AddedReason { get; set; }
    [JsonProperty("addedBy")]               public string? AddedBy { get; set; }
}

public class ShipmentScanEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "";
    public string RowKey { get; set; } = "";
    public string OrderId { get; set; } = "";
    public string OrderName { get; set; } = "";
    public string FulfillmentId { get; set; } = "";
    public string TrackingNumber { get; set; } = "";
    public string? FulfillmentLineItemId { get; set; }
    public string? LineItemId { get; set; }
    public string? VariantId { get; set; }
    public string? Sku { get; set; }
    public string? Barcode { get; set; }
    public string? Plu { get; set; }
    public string? ProductTitle { get; set; }
    public string? VariantTitle { get; set; }
    public int QuantityShipped { get; set; } = 1;
    public double? WeightGrams { get; set; }
    public double? PricePerLb { get; set; }
    public double? TotalPriceScanned { get; set; }
    public bool IsVariableWeight { get; set; }
    public string ScannedBy { get; set; } = "";
    public DateTimeOffset ScannedAt { get; set; }
    public bool IsManualLineItem { get; set; }
    public bool IsManualOverride { get; set; }
    public string? OverrideReason { get; set; }
    public bool IsExtra { get; set; }
    public bool IsRemoval { get; set; }
    public string? ExtraReason { get; set; }
    public string? Price { get; set; }
    public double? Weight { get; set; }
    public string? WeightUnit { get; set; }
    public string? QrSn { get; set; }
    public string? PackagedAt { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class ScannedLabelEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "sn";
    public string RowKey { get; set; } = "";   // the label's serial number
    public string FulfillmentId { get; set; } = "";
    public DateTimeOffset ScannedAt { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class RecordShipScanRequest
{
    [JsonProperty("fulfillmentId")]         public string FulfillmentId { get; set; } = "";
    [JsonProperty("barcode")]               public string? Barcode { get; set; }
    [JsonProperty("weightGrams")]           public double? WeightGrams { get; set; }
    [JsonProperty("pricePerLb")]            public double? PricePerLb { get; set; }
    [JsonProperty("totalPriceScanned")]     public double? TotalPriceScanned { get; set; }
    [JsonProperty("isVariableWeight")]      public bool IsVariableWeight { get; set; }
    [JsonProperty("isManualLineItem")]      public bool IsManualLineItem { get; set; }
    [JsonProperty("fulfillmentLineItemId")] public string? FulfillmentLineItemId { get; set; }
    [JsonProperty("scannedBy")]             public string ScannedBy { get; set; } = "";
    [JsonProperty("plu")]                   public string? Plu { get; set; }
    [JsonProperty("qrSn")]                  public string? QrSn { get; set; }
    [JsonProperty("packagedAt")]            public string? PackagedAt { get; set; }
}

public class AddExtraItemRequest
{
    [JsonProperty("fulfillmentId")] public string FulfillmentId { get; set; } = "";
    [JsonProperty("barcode")]       public string Barcode { get; set; } = "";
    [JsonProperty("reason")]        public string Reason { get; set; } = "";
    [JsonProperty("scannedBy")]     public string ScannedBy { get; set; } = "";
    [JsonProperty("plu")]           public string? Plu { get; set; }
    [JsonProperty("qrSn")]          public string? QrSn { get; set; }
    [JsonProperty("weightGrams")]   public double? WeightGrams { get; set; }
    [JsonProperty("packagedAt")]    public string? PackagedAt { get; set; }
}

public class RemoveScanRequest
{
    [JsonProperty("fulfillmentId")]         public string FulfillmentId { get; set; } = "";
    [JsonProperty("fulfillmentLineItemId")] public string FulfillmentLineItemId { get; set; } = "";
    [JsonProperty("scannedBy")]             public string ScannedBy { get; set; } = "";
}

public class CompleteShipmentRequest
{
    [JsonProperty("fulfillmentId")] public string FulfillmentId { get; set; } = "";
    [JsonProperty("scannedBy")]     public string ScannedBy { get; set; } = "";
    [JsonProperty("reason")]        public string? Reason { get; set; }
}

// ─── Scale & Print Mode ──────────────────────────────────────────────────────

public class ProductLookupEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "product";
    public string RowKey { get; set; } = "";       // scale item number, or "v:<variantId>" when unmapped to a slot
    public string Plu { get; set; } = "";
    public string ProductTitle { get; set; } = "";
    public double PricePerLb { get; set; }
    public string? ItemNumber { get; set; }        // optional scale slot; mirrors RowKey when RowKey is numeric
    public string? ProductId { get; set; }          // full GID, set when created via the product picker
    public string? VariantId { get; set; }          // full GID
    public string? VariantTitle { get; set; }
    public string? ImageUrl { get; set; }
    public bool Pinned { get; set; }
    public bool NoWeight { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class UpsertProductLookupRequest
{
    [JsonProperty("itemNumber")]         public string ItemNumber { get; set; } = "";
    [JsonProperty("previousItemNumber")] public string? PreviousItemNumber { get; set; }
    [JsonProperty("plu")]                public string Plu { get; set; } = "";
    [JsonProperty("productTitle")]       public string ProductTitle { get; set; } = "";
    [JsonProperty("pricePerLb")]         public double PricePerLb { get; set; }
    [JsonProperty("pinned")]             public bool? Pinned { get; set; }
}

public class UpsertScaleProductRequest
{
    [JsonProperty("productId")]     public string ProductId { get; set; } = "";
    [JsonProperty("variantId")]     public string VariantId { get; set; } = "";
    [JsonProperty("productTitle")]  public string ProductTitle { get; set; } = "";
    [JsonProperty("variantTitle")]  public string? VariantTitle { get; set; }
    [JsonProperty("imageUrl")]      public string? ImageUrl { get; set; }
    [JsonProperty("itemNumber")]    public string? ItemNumber { get; set; }
    [JsonProperty("plu")]           public string Plu { get; set; } = "";
    [JsonProperty("pricePerLb")]    public double PricePerLb { get; set; }
    [JsonProperty("pinned")]        public bool Pinned { get; set; }
    [JsonProperty("noWeight")]      public bool NoWeight { get; set; }
}

public class PrintedLabelEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "";  // date yyyyMMdd (EST)
    public string RowKey { get; set; } = "";        // GUID
    public string ItemNumber { get; set; } = "";
    public string Plu { get; set; } = "";
    public string ProductTitle { get; set; } = "";
    public string ItemWeight { get; set; } = "";
    public string PrintedAtEst { get; set; } = "";
    public string QrPayload { get; set; } = "";
    public string? PrintedBy { get; set; }
    public string? Sn { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class LogPrintedLabelRequest
{
    [JsonProperty("itemNumber")]   public string ItemNumber { get; set; } = "";
    [JsonProperty("plu")]          public string Plu { get; set; } = "";
    [JsonProperty("productTitle")] public string ProductTitle { get; set; } = "";
    [JsonProperty("itemWeight")]   public string ItemWeight { get; set; } = "";
    [JsonProperty("printedAtEst")] public string PrintedAtEst { get; set; } = "";
    [JsonProperty("qrPayload")]    public string QrPayload { get; set; } = "";
    [JsonProperty("printedBy")]    public string? PrintedBy { get; set; }
    [JsonProperty("sn")]           public string? Sn { get; set; }
}

public class SnCounterEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "sn";
    public string RowKey { get; set; } = "";   // variantId numeric suffix, or "plu:{plu}"
    public int Count { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class NextSnRequest
{
    [JsonProperty("variantId")] public string? VariantId { get; set; }
    [JsonProperty("plu")]       public string? Plu { get; set; }
    [JsonProperty("prefix")]    public string Prefix { get; set; } = "";
}
