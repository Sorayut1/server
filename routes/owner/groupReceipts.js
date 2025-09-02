// utils/groupReceipts.js (แนะนำให้แยกไฟล์ แต่ถ้าอยากเขียนรวมก็ได้)
const db = require("../../config/db");

function groupReceipts(rows) {
  const acc = {};
  rows.forEach(row => {
    if (!acc[row.temp_receipt_code]) {
      acc[row.temp_receipt_code] = {
        temp_receipt_id: row.temp_receipt_id,
        temp_receipt_code: row.temp_receipt_code,
        table_number: row.table_number,
        temp_receipt_time: row.temp_receipt_time,
        orders: [],
      };
    }
    if (row.order_id) {
      let order = acc[row.temp_receipt_code].orders.find(o => o.order_id === row.order_id);
      if (!order) {
        order = {
          order_id: row.order_id,
          table_number: row.table_number,
          order_time: row.order_time,
          status: row.status,
          total_price: parseFloat(row.total_price) || 0,
          order_code: row.order_code,
          status_pay: row.status_pay,
          payment_slip: row.payment_slip,
          items: [],
        };
        acc[row.temp_receipt_code].orders.push(order);
      }
      if (row.item_id) {
        order.items.push({
          item_id: row.item_id,
          menu_id: row.menu_id,
          menu_name: row.menu_name,
          quantity: row.quantity,
          price: parseFloat(row.price) || 0,
          note: row.note || '',
          specialRequest: row.specialRequest || '',
        });
      }
    }
  });
  return acc;
}
module.exports = { groupReceipts };
