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

public class WeightRangeRule
{
    [JsonProperty("variantId")]  public string VariantId { get; set; } = "";
    [JsonProperty("label")]      public string Label { get; set; } = "";
    [JsonProperty("minLbs")]     public double MinLbs { get; set; }
    [JsonProperty("maxLbs")]     public double? MaxLbs { get; set; }
}

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
    public string WeightRanges { get; set; } = "[]"; // JSON-encoded WeightRangeRule[] — per-product, same on all variants
    public string? Adjustments { get; set; }          // custom.adjustments metafield JSON (null if absent)
    public string? InventoryItemId { get; set; }      // gid://shopify/InventoryItem/xxx — for transformation child lookups
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
    public string LastSyncStages { get; set; } = ""; // JSON-encoded List<FullSyncStageResult>
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
    [JsonProperty("productId")]             public string? ProductId { get; set; }
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
    // PO traceability — set when printed from a PO suggestion
    public string? PoId { get; set; }
    public string? PoLineItemId { get; set; }
    public string? VendorName { get; set; }
    public string? LotNo { get; set; }
    public string? ExpiryDate { get; set; }
    public string? VariantId { get; set; }
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
    [JsonProperty("poId")]         public string? PoId { get; set; }
    [JsonProperty("poLineItemId")] public string? PoLineItemId { get; set; }
    [JsonProperty("vendorName")]   public string? VendorName { get; set; }
    [JsonProperty("lotNo")]        public string? LotNo { get; set; }
    [JsonProperty("expiryDate")]   public string? ExpiryDate { get; set; }
    [JsonProperty("variantId")]    public string? VariantId { get; set; }
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

// ─── Auto-sync config (syncsettings table, RowKey = "autosync") ───────────────

public class AutoSyncConfigEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "settings";
    public string RowKey { get; set; } = "autosync";
    public bool AutoSyncEnabled { get; set; }
    public string Vendors { get; set; } = "";
    public string Tags { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class AutoSyncConfigRequest
{
    [JsonProperty("autoSyncEnabled")] public bool AutoSyncEnabled { get; set; }
    [JsonProperty("vendors")]         public List<string>? Vendors { get; set; }
    [JsonProperty("tags")]            public List<string>? Tags { get; set; }
}

// ─── Variant title text mappings (textmappings table) ────────────────────────

public class TextMappingEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "mapping";
    public string RowKey { get; set; } = "";      // normalized phrase (lowercase, spaces→_, stripped)
    public string Phrase { get; set; } = "";       // original phrase as entered
    public string Abbreviation { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public static string NormalizeKey(string phrase)
    {
        var raw = phrase.Trim().ToLowerInvariant()
            .Replace(' ', '_').Replace(',', '_').Replace('.', '_')
            .Replace('/', '_').Replace('\\', '_').Replace('#', '_').Replace('?', '_');
        return string.Concat(raw.Where(c => char.IsLetterOrDigit(c) || c == '_'));
    }
}

public class TextMappingRequest
{
    [JsonProperty("phrase")]       public string Phrase { get; set; } = "";
    [JsonProperty("abbreviation")] public string Abbreviation { get; set; } = "";
}

public class TextMappingDeleteRequest
{
    [JsonProperty("phrase")] public string Phrase { get; set; } = "";
}

// ─── Purchase Orders ──────────────────────────────────────────────────────────

public class PurchaseOrderEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "po";
    public string RowKey { get; set; } = "";           // numeric PO ID
    public string PoId { get; set; } = "";             // full GID
    public string PoName { get; set; } = "";           // e.g. "PO-1001"
    public string Status { get; set; } = "open";       // open | partial | fulfilled
    public string Vendor { get; set; } = "";
    public int TotalLineItems { get; set; }
    public int ApprovedLineItems { get; set; }
    public DateTimeOffset ShopifyCreatedAt { get; set; }
    public DateTimeOffset ShopifyUpdatedAt { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class PurchaseOrderLineItemEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "";     // numeric PO ID
    public string RowKey { get; set; } = "";           // numeric line item ID
    public string LineItemId { get; set; } = "";
    public string ProductTitle { get; set; } = "";
    public string? VariantTitle { get; set; }
    public string? VariantId { get; set; }
    public string? Sku { get; set; }
    public int QuantityOrdered { get; set; }
    public int QuantityReceived { get; set; }
    public string Status { get; set; } = "pending";   // pending | partial | approved
    public DateTimeOffset? PrintedAt { get; set; }
    public string? PrintedBy { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

// GQL InventoryPurchaseOrder (Shopify unstable API — native PO feature)
public class GqlInventoryPurchaseOrder
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Status { get; set; } = "";
    public string DateCreated { get; set; } = "";
    public GqlInventorySupplierSnapshot? Origin { get; set; }
    public List<GqlInventoryPurchaseOrderLineItem> LineItems { get; set; } = new();
}

public class GqlInventorySupplierSnapshot
{
    public string? SupplierName { get; set; }
}

public class GqlInventoryPurchaseOrderLineItem
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string? VariantTitle { get; set; }
    public int TotalQuantity { get; set; }
    public GqlInventoryItemRef? InventoryItem { get; set; }
}

public class GqlInventoryItemRef
{
    public string Id { get; set; } = "";
    public string? Sku { get; set; }
    public GqlVariantRef? Variant { get; set; }
}

public class GqlVariantRef
{
    public string Id { get; set; } = "";
    public string? Title { get; set; }
    public GqlProductRef? Product { get; set; }
}

public class GqlProductRef
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
}

public class WebhookResult
{
    public string Id { get; set; } = "";
    public string Topic { get; set; } = "";
    public string Address { get; set; } = "";
}

// Webhook REST payload for purchase_orders/create and purchase_orders/update
public class WebhookPurchaseOrder
{
    [JsonProperty("id")]          public long Id { get; set; }
    [JsonProperty("name")]        public string Name { get; set; } = "";
    [JsonProperty("status")]      public string Status { get; set; } = "open";
    [JsonProperty("vendor_name")] public string? VendorName { get; set; }
    [JsonProperty("note")]        public string? Note { get; set; }
    [JsonProperty("created_at")]  public string CreatedAt { get; set; } = "";
    [JsonProperty("updated_at")]  public string UpdatedAt { get; set; } = "";
    [JsonProperty("line_items")]  public List<WebhookPurchaseOrderLineItem> LineItems { get; set; } = new();
}

public class WebhookPurchaseOrderLineItem
{
    [JsonProperty("id")]            public long Id { get; set; }
    [JsonProperty("product_title")] public string ProductTitle { get; set; } = "";
    [JsonProperty("variant_title")] public string? VariantTitle { get; set; }
    [JsonProperty("variant_id")]    public long? VariantId { get; set; }
    [JsonProperty("sku")]           public string? Sku { get; set; }
    [JsonProperty("quantity")]      public int Quantity { get; set; }
}

public class ApprovePurchaseOrderLineItemRequest
{
    [JsonProperty("poId")]             public string PoId { get; set; } = "";
    [JsonProperty("lineItemId")]       public string LineItemId { get; set; } = "";
    [JsonProperty("quantityReceived")] public int QuantityReceived { get; set; }
    [JsonProperty("printedBy")]        public string PrintedBy { get; set; } = "";
    [JsonProperty("forceApprove")]     public bool ForceApprove { get; set; } = false;
}

public class InventoryAdjustRequest
{
    [JsonProperty("inventoryItemId")] public string InventoryItemId { get; set; } = "";
    [JsonProperty("locationId")]      public string LocationId { get; set; } = "";
    [JsonProperty("delta")]           public int Delta { get; set; }
    [JsonProperty("reason")]          public string Reason { get; set; } = "correction";
}

// ─── Print Jobs (Cross-Device Print Sync) ────────────────────────────────────

public class PrintJobEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "";   // userId
    public string RowKey { get; set; } = "";          // job GUID
    public string Status { get; set; } = "queued";   // queued | claimed | completed | failed
    public string Payload { get; set; } = "{}";      // JSON: PrintJobPayload
    public string JobType { get; set; } = "label";   // label | barcode
    public string CreatedBy { get; set; } = "";      // deviceId
    public string? ClaimedBy { get; set; }
    public DateTimeOffset? ClaimedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? FailedReason { get; set; }
    public int RetryCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class CreatePrintJobRequest
{
    [JsonProperty("payload")]   public string Payload { get; set; } = "{}";
    [JsonProperty("jobType")]   public string JobType { get; set; } = "label";
    [JsonProperty("createdBy")] public string CreatedBy { get; set; } = "";
}

public class ClaimPrintJobRequest
{
    [JsonProperty("deviceId")] public string DeviceId { get; set; } = "";
}

public class FailPrintJobRequest
{
    [JsonProperty("reason")] public string Reason { get; set; } = "";
}

public class TransformationOption
{
    [JsonProperty("variantId")]             public string VariantId { get; set; } = "";
    [JsonProperty("title")]                 public string Title { get; set; } = "";
    [JsonProperty("productTitle")]          public string ProductTitle { get; set; } = "";
    [JsonProperty("inventoryItemId")]       public string InventoryItemId { get; set; } = "";
    [JsonProperty("parentInventoryItemId")] public string ParentInventoryItemId { get; set; } = "";
    [JsonProperty("locationId")]            public string LocationId { get; set; } = "";
    [JsonProperty("parentUnits")]           public int ParentUnits { get; set; } = 1;
    [JsonProperty("childUnits")]            public int ChildUnits { get; set; } = 1;
    [JsonProperty("isWeighted")]            public bool IsWeighted { get; set; } = false;
    [JsonProperty("weightPerUnit")]         public double WeightPerUnit { get; set; } = 0.0;
}

// ─── Bulk Print Sessions ──────────────────────────────────────────────────────

public class BulkSessionEntity : ITableEntity
{
    public string PartitionKey { get; set; } = ""; // userId
    public string RowKey { get; set; } = "";       // session GUID
    public string ProductTitle { get; set; } = "";
    public string? VariantTitle { get; set; }
    public string? PoId { get; set; }
    public string? PoLineItemId { get; set; }
    public string? VendorName { get; set; }
    public string? LotNo { get; set; }
    public string? ExpiryDate { get; set; }
    public int QuantityOrdered { get; set; }
    public int QuantityPrinted { get; set; }
    public string Results { get; set; } = "[]"; // JSON: BulkSessionLabelResult[]
    public string SessionDateEst { get; set; } = ""; // yyyy-MM-dd HH:mm:ss EST
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class BulkSessionLabelResult
{
    [JsonProperty("index")]        public int Index { get; set; }
    [JsonProperty("sn")]           public string Sn { get; set; } = "";
    [JsonProperty("qrPayload")]    public string QrPayload { get; set; } = "";
    [JsonProperty("printedAtEst")] public string PrintedAtEst { get; set; } = "";
    [JsonProperty("status")]       public string Status { get; set; } = ""; // printed | failed
    [JsonProperty("error")]        public string? Error { get; set; }
}

public class SaveBulkSessionRequest
{
    [JsonProperty("productTitle")]    public string ProductTitle { get; set; } = "";
    [JsonProperty("variantTitle")]    public string? VariantTitle { get; set; }
    [JsonProperty("poId")]            public string? PoId { get; set; }
    [JsonProperty("poLineItemId")]    public string? PoLineItemId { get; set; }
    [JsonProperty("vendorName")]      public string? VendorName { get; set; }
    [JsonProperty("lotNo")]           public string? LotNo { get; set; }
    [JsonProperty("expiryDate")]      public string? ExpiryDate { get; set; }
    [JsonProperty("quantityOrdered")] public int QuantityOrdered { get; set; }
    [JsonProperty("quantityPrinted")] public int QuantityPrinted { get; set; }
    [JsonProperty("results")]         public List<BulkSessionLabelResult> Results { get; set; } = new();
    [JsonProperty("sessionDateEst")]  public string SessionDateEst { get; set; } = "";
}

public class SaveWeightRangesRequest
{
    [JsonProperty("productId")] public string ProductId { get; set; } = "";
    [JsonProperty("rules")]     public List<WeightRangeRule>? Rules { get; set; }
}

// ─── Webhook Registration ─────────────────────────────────────────────────────

public class WebhookRegistrationResult
{
    [JsonProperty("topic")]  public string Topic { get; set; } = "";
    [JsonProperty("status")] public string Status { get; set; } = ""; // registered | already_registered | error
    [JsonProperty("error")]  public string? Error { get; set; }
}

public class RegisterWebhooksRequest
{
    [JsonProperty("callbackBaseUrl")] public string CallbackBaseUrl { get; set; } = "";
}

// ─── Vendor Management ────────────────────────────────────────────────────────

public class VendorEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "vendor";
    public string RowKey { get; set; } = "";          // GUID
    public string VendorName { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}

public class CreateVendorRequest
{
    [JsonProperty("vendorName")] public string VendorName { get; set; } = "";
}

// ─── Full Sync ────────────────────────────────────────────────────────────────

public class FullSyncStageResult
{
    [JsonProperty("stage")]   public string Stage { get; set; } = "";
    [JsonProperty("count")]   public int Count { get; set; }
    [JsonProperty("ok")]      public bool Ok { get; set; }
    [JsonProperty("error")]   public string? Error { get; set; }
}

public class FullSyncResult
{
    [JsonProperty("ok")]          public bool Ok { get; set; }
    [JsonProperty("syncedAt")]    public string SyncedAt { get; set; } = "";
    [JsonProperty("stages")]      public List<FullSyncStageResult> Stages { get; set; } = new();
}

// ─── Processing Session (CRH-219) ────────────────────────────────────────────

public class ProcessingSessionEntity : ITableEntity
{
    public string PartitionKey { get; set; } = ""; // poLineItemId
    public string RowKey { get; set; } = "";       // sessionId (GUID)
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    [JsonProperty("poId")]             public string PoId { get; set; } = "";
    [JsonProperty("poLineItemId")]     public string PoLineItemId { get; set; } = "";
    [JsonProperty("mainVariantId")]    public string MainVariantId { get; set; } = "";
    [JsonProperty("mainProductTitle")] public string MainProductTitle { get; set; } = "";
    [JsonProperty("poQty")]            public int PoQty { get; set; }
    [JsonProperty("sessionQty")]       public int SessionQty { get; set; }
    [JsonProperty("cumulativeQty")]    public int CumulativeQty { get; set; }
    [JsonProperty("wastageQty")]       public int WastageQty { get; set; }
    [JsonProperty("sessionStatus")]    public string SessionStatus { get; set; } = "partial"; // partial | completed
    [JsonProperty("variantBreakdown")] public string VariantBreakdown { get; set; } = "{}";  // JSON: {"Small":45,"Medium":80}
    [JsonProperty("vendorName")]       public string VendorName { get; set; } = "";
    [JsonProperty("lotNo")]            public string LotNo { get; set; } = "";
    [JsonProperty("processedBy")]      public string ProcessedBy { get; set; } = "";
    [JsonProperty("processedAt")]      public string ProcessedAt { get; set; } = "";
}

public class SaveProcessingSessionRequest
{
    [JsonProperty("poId")]             public string PoId { get; set; } = "";
    [JsonProperty("poLineItemId")]     public string PoLineItemId { get; set; } = "";
    [JsonProperty("mainVariantId")]    public string MainVariantId { get; set; } = "";
    [JsonProperty("mainProductTitle")] public string MainProductTitle { get; set; } = "";
    [JsonProperty("poQty")]            public int PoQty { get; set; }
    [JsonProperty("sessionQty")]       public int SessionQty { get; set; }
    [JsonProperty("wastageQty")]       public int WastageQty { get; set; }
    [JsonProperty("sessionStatus")]    public string SessionStatus { get; set; } = "partial";
    [JsonProperty("variantBreakdown")] public Dictionary<string, int>? VariantBreakdown { get; set; }
    [JsonProperty("vendorName")]       public string VendorName { get; set; } = "";
    [JsonProperty("lotNo")]            public string LotNo { get; set; } = "";
}
