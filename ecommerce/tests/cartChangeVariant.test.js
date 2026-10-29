import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Cart & Checkout Variant Change Logic Tests", () => {
  const MAX_CART_QUANTITY = 5;

  const simulateChangeVariant = ({
    cartItems,
    oldVariantId,
    newVariant,
    currentProductId,
  }) => {
    if (!oldVariantId || !newVariant?._id) {
      return { success: false, status: 400, message: "Old and new variant IDs are required" };
    }

    if (String(oldVariantId) === String(newVariant._id)) {
      return { success: true, message: "Variant unchanged", cartItems };
    }

    const itemIndex = cartItems.findIndex(
      (item) => String(item.variant_id) === String(oldVariantId)
    );

    if (itemIndex === -1) {
      return { success: false, status: 404, message: "Cart item not found" };
    }

    if (String(newVariant.product_id) !== String(currentProductId)) {
      return { success: false, status: 400, message: "Invalid variant for this product" };
    }

    if (Number(newVariant.stock_quantity) <= 0) {
      return { success: false, status: 400, message: "This variant is out of stock" };
    }

    const updatedItems = cartItems.map((item) => ({ ...item }));
    const currentItem = updatedItems[itemIndex];

    const existingIndex = updatedItems.findIndex(
      (item) => String(item.variant_id) === String(newVariant._id)
    );

    if (existingIndex !== -1 && existingIndex !== itemIndex) {
      const mergedQty = updatedItems[existingIndex].quantity + currentItem.quantity;
      const finalQty = Math.min(
        mergedQty,
        MAX_CART_QUANTITY,
        newVariant.stock_quantity
      );
      updatedItems[existingIndex].quantity = finalQty;
      updatedItems.splice(itemIndex, 1);
    } else {
      currentItem.variant_id = newVariant._id;
      if (currentItem.quantity > newVariant.stock_quantity) {
        currentItem.quantity = Math.max(1, newVariant.stock_quantity);
      }
      if (currentItem.quantity > MAX_CART_QUANTITY) {
        currentItem.quantity = MAX_CART_QUANTITY;
      }
    }

    return {
      success: true,
      message: "Variant updated successfully",
      cartItems: updatedItems,
      totalCount: updatedItems.reduce((sum, itm) => sum + itm.quantity, 0),
    };
  };

  it("returns unchanged when old and new variant IDs match", () => {
    const res = simulateChangeVariant({
      cartItems: [{ variant_id: "v1", product_id: "p1", quantity: 2 }],
      oldVariantId: "v1",
      newVariant: { _id: "v1", product_id: "p1", stock_quantity: 10 },
      currentProductId: "p1",
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.message, "Variant unchanged");
  });

  it("rejects variant belonging to a different product", () => {
    const res = simulateChangeVariant({
      cartItems: [{ variant_id: "v1", product_id: "p1", quantity: 2 }],
      oldVariantId: "v1",
      newVariant: { _id: "v_diff", product_id: "p2", stock_quantity: 10 },
      currentProductId: "p1",
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.message, "Invalid variant for this product");
  });

  it("rejects out of stock variant", () => {
    const res = simulateChangeVariant({
      cartItems: [{ variant_id: "v1", product_id: "p1", quantity: 2 }],
      oldVariantId: "v1",
      newVariant: { _id: "v2", product_id: "p1", stock_quantity: 0 },
      currentProductId: "p1",
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.message, "This variant is out of stock");
  });

  it("updates variant ID and preserves quantity when stock is sufficient", () => {
    const res = simulateChangeVariant({
      cartItems: [{ variant_id: "v1", product_id: "p1", quantity: 3 }],
      oldVariantId: "v1",
      newVariant: { _id: "v2", product_id: "p1", stock_quantity: 10 },
      currentProductId: "p1",
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.cartItems.length, 1);
    assert.strictEqual(res.cartItems[0].variant_id, "v2");
    assert.strictEqual(res.cartItems[0].quantity, 3);
  });

  it("clamps quantity when new variant has lower available stock", () => {
    const res = simulateChangeVariant({
      cartItems: [{ variant_id: "v1", product_id: "p1", quantity: 4 }],
      oldVariantId: "v1",
      newVariant: { _id: "v2", product_id: "p1", stock_quantity: 2 },
      currentProductId: "p1",
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.cartItems[0].variant_id, "v2");
    assert.strictEqual(res.cartItems[0].quantity, 2);
  });

  it("merges duplicate items when changing to a variant already in the cart", () => {
    const cartItems = [
      { variant_id: "v1", product_id: "p1", quantity: 2 },
      { variant_id: "v2", product_id: "p1", quantity: 1 },
    ];

    const res = simulateChangeVariant({
      cartItems,
      oldVariantId: "v1",
      newVariant: { _id: "v2", product_id: "p1", stock_quantity: 10 },
      currentProductId: "p1",
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.cartItems.length, 1);
    assert.strictEqual(res.cartItems[0].variant_id, "v2");
    assert.strictEqual(res.cartItems[0].quantity, 3);
  });
});
