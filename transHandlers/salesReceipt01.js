import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { db } from '../auth.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from '../app.js';

export async function pushSalesReceipts(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');
    const orders = {};
    data.forEach(t => {
        if (!t.category) throw new Error("Missing category mapping in Sales.");
        const oId = t['order id'] || t.uid; 
        if (!orders[oId]) orders[oId] = { marketplace: t.marketplace, date: t['date/time'], settlementId: t['settlement id'], lines: [] };
        orders[oId].lines.push(t);
    });

    let pushedIds = [];
    let rejected = [];

    for (const [orderId, orderData] of Object.entries(orders)) {
        const customerName = `${orderData.marketplace || 'Amazon'} Customer`;
        
        // QBO Payload Date (Strictly YYYY-MM-DD)
        const txnDate = orderData.date ? new Date(orderData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        
        // Signature Date (Exact Millisecond Timestamp)
        const exactTimeMs = orderData.date ? new Date(orderData.date).getTime() : Date.now();

        let netAmount = 0;
        const qboLines = orderData.lines.map((line, index) => {
            const amt = parseFloat(line.total || 0);
            const qty = parseFloat(line.quantity || 1);
            netAmount += amt;
            
            const skuVal = (line.sku || "").trim();
            const combinedItemName = skuVal ? `${skuVal} - ${line.lineItem}` : line.lineItem;

            return {
                "Id": (index + 1).toString(),
                "Description": line.description || line.lineItem,
                "Amount": amt, 
                "DetailType": "SalesItemLineDetail",
                "SalesItemLineDetail": {
                    "Qty": qty,
                    "UnitPrice": amt / qty, 
                    "ItemRef": {
                        "value": line.category, 
                        "name": combinedItemName.substring(0, 100) 
                    },
                    "_ItemSku": skuVal,
                    "_ItemDesc": line.description || line.lineItem
                }
            };
        });

        // Use exactTimeMs to prevent false duplicates
        const signature = `SALES_${exactTimeMs}_${orderData.settlementId}_${netAmount.toFixed(2)}`;
        const ledgerRef = doc(db, "users", currentUser.uid, "qbo_sync_ledger", signature);
        const ledgerSnap = await getDoc(ledgerRef);
        
        if (ledgerSnap.exists()) {
            orderData.lines.forEach(l => rejected.push(l));
            continue; 
        }

        const payload = {
            "entityType": "SalesReceipt",
            "realmId": config.realmId,
            "data": {
                "DocNumber": orderId.substring(0, 21), 
                "TxnDate": txnDate,
                "CustomerRef": { "name": customerName }, 
                "DepositToAccountRef": { "name": config.depositAccountName },
                "PrivateNote": `Order ID: ${orderId}`,
                "Line": qboLines
            }
        };

        const res = await pushQboEntity(payload);
        await setDoc(ledgerRef, { batchId: config.batchId, qboId: res.data.qboResponseId, timestamp: new Date().toISOString() });
        pushedIds.push({ type: "SalesReceipt", id: res.data.qboResponseId });
    }
    
    if (rejected.length > 0) context.showRejectionModal(rejected);
    return pushedIds;
}
