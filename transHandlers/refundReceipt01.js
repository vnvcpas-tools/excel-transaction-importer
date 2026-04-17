import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";

export async function pushRefundReceipts(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');
    
    const refunds = {};
    data.forEach(t => {
        if (!t.category) throw new Error("Missing category mapping in Refunds.");
        const oId = t['order id'] || t.uid;
        if (!refunds[oId]) refunds[oId] = { marketplace: t.marketplace, date: t['date/time'], lines: [] };
        refunds[oId].lines.push(t);
    });

    for (const [orderId, refundData] of Object.entries(refunds)) {
        const customerName = `${refundData.marketplace || 'Amazon'} Customer`;
        const txnDate = refundData.date ? new Date(refundData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

        const qboLines = refundData.lines.map((line, index) => {
            return {
                "Id": (index + 1).toString(),
                "Description": line.description || line.lineItem,
                "Amount": Math.abs(parseFloat(line.total)),
                "DetailType": "SalesItemLineDetail",
                "SalesItemLineDetail": {
                    "Qty": parseFloat(line.quantity || 1),
                    "ItemRef": { "value": line.category, "name": line.sku || "Custom-Refund-Item" }
                }
            };
        });

        const payload = {
            "entityType": "RefundReceipt",
            "realmId": config.realmId,
            "data": {
                "DocNumber": orderId.substring(0, 21),
                "TxnDate": txnDate,
                "CustomerRef": { "name": customerName },
                "DepositToAccountRef": { "name": config.depositAccountName },
                "PrivateNote": `Refund for Order ID: ${orderId}`,
                "Line": qboLines
            }
        };

        await pushQboEntity(payload);
    }
    context.showAlert(`Success! Created ${Object.keys(refunds).length} Refund Receipts in QBO.`, "success");
}
