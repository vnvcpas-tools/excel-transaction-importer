import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";

export async function pushSalesReceipts(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');
    
    // Group by Order ID
    const orders = {};
    data.forEach(t => {
        if (!t.category) throw new Error("Missing category mapping in Sales.");
        const oId = t['order id'] || t.uid; // fallback if missing
        if (!orders[oId]) orders[oId] = { marketplace: t.marketplace, date: t['date/time'], lines: [] };
        orders[oId].lines.push(t);
    });

    for (const [orderId, orderData] of Object.entries(orders)) {
        const customerName = `${orderData.marketplace || 'Amazon'} Customer`;
        const txnDate = orderData.date ? new Date(orderData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

        // Format Payload for QBO SalesReceipt
        const qboLines = orderData.lines.map((line, index) => {
            return {
                "Id": (index + 1).toString(),
                "Description": line.description || line.lineItem,
                "Amount": Math.abs(parseFloat(line.total)),
                "DetailType": "SalesItemLineDetail",
                "SalesItemLineDetail": {
                    "Qty": parseFloat(line.quantity || 1),
                    "ItemRef": {
                        "value": line.category, // Backend will auto-resolve this to Item ID
                        "name": line.sku || "Custom-Item"
                    }
                }
            };
        });

        const payload = {
            "entityType": "SalesReceipt",
            "realmId": config.realmId,
            "data": {
                "DocNumber": orderId.substring(0, 21), // QBO Max length
                "TxnDate": txnDate,
                "CustomerRef": { "name": customerName }, // Backend will auto-resolve Customer
                "DepositToAccountRef": { "name": config.depositAccountName },
                "PrivateNote": `Order ID: ${orderId}`,
                "Line": qboLines
            }
        };

        await pushQboEntity(payload);
    }
    context.showAlert(`Success! Created ${Object.keys(orders).length} Sales Receipts in QBO.`, "success");
}
