import PDFDocument from "pdfkit";

export const generateInvoicePDF = (
  order,
  res
) => {

  const doc =
    new PDFDocument({
      margin: 50,
    });


  res.setHeader(
    "Content-Type",
    "application/pdf"
  );


  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${order.order_id}.pdf"`
  );


  doc.pipe(res);


  doc
    .fontSize(22)
    .text(
      "YOUR STORE",
      {
        align: "center",
      }
    );


  doc.moveDown();


  doc
    .fontSize(16)
    .text(
      "INVOICE",
      {
        align: "center",
      }
    );


  doc.moveDown(2);


  doc.fontSize(11);


  doc.text(
    `Order ID: ${order.order_id}`
  );

  doc.text(
    `Order Date: ${order.createdAt}`
  );

  doc.text(
    `Payment Method: ${order.payment_method}`
  );


  doc.moveDown();


  doc
    .fontSize(13)
    .text("Customer");


  doc.fontSize(11);


  doc.text(
    order.shipping_address.full_name
  );

  doc.text(
    order.shipping_address.address
  );

  doc.text(
    `${order.shipping_address.city}, ${order.shipping_address.state}`
  );

  doc.text(
    order.shipping_address.zip_code
  );

  doc.text(
    order.shipping_address.phone_number
  );


  doc.moveDown(2);


  doc
    .fontSize(13)
    .text("Products");


  doc.moveDown();


  order.items.forEach(
    (item, index) => {

      doc
        .fontSize(11)
        .text(
          `${index + 1}. ${item.product_name}`
        );

      doc.text(
        `SKU: ${item.sku}`
      );

      doc.text(
        `Quantity: ${item.quantity}`
      );

      doc.text(
        `Price: ₹${item.price}`
      );

      doc.text(
        `Total: ₹${item.item_total}`
      );

      doc.moveDown();
    }
  );


  doc.moveDown();


  doc
    .fontSize(11)
    .text(
      `Subtotal: ₹${order.subtotal}`
    );

  doc.text(
    `Discount: ₹${order.discount}`
  );

  doc.text(
    `Tax: ₹${order.tax}`
  );

  doc.text(
    `Shipping: ₹${order.shipping_charge}`
  );


  doc.moveDown();


  doc
    .fontSize(15)
    .text(
      `Total: ₹${order.final_amount}`
    );


  doc.moveDown(2);


  doc
    .fontSize(10)
    .text(
      "Thank you for shopping with us!"
    );


  doc.end();
};