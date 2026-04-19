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
        const dateStamp = t['date/time'] || 'nodate';
        const settlementId = t['settlement id'] || 'nosettlement';
        const groupKey = `${oId}_${dateStamp}_${settlementId}`;
        
        if (!orders[groupKey]) orders[groupKey] = { orderId: oId, marketplace: t.marketplace, date: t['date/time'], settlementId: t['settlement id'], lines: [] };
        orders[groupKey].lines.push(t);
    });

    let pushedIds = [];
    let rejected = [];

    const totalLines = data.length;
    const totalTxns = Object.keys(orders).length;
    let txnsPushed = 0;
    let linesPushed = 0;
    const typeName = "sales receipt";

    for (const [groupKey, orderData] of Object.entries(orders)) {
        const orderId = orderData.orderId;
        const customerName = `${orderData.marketplace || 'Amazon'} Customer`;
        
        const txnDate = context.getAmazonDateStr(orderData.date);
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

        const signature = `SALES_${exactTimeMs}_${orderData.settlementId}_${netAmount.toFixed(2)}`;
        const ledgerRef = doc(db, "users", currentUser.uid, "qbo_sync_ledger", signature);
        const ledgerSnap = await getDoc(ledgerRef);
        
        if (ledgerSnap.exists()) {
            orderData.lines.forEach(l => rejected.push(l));
            txnsPushed++;
            linesPushed += orderData.lines.length;
            if (context && context.updatePushProgress) context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
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

        txnsPushed++;
        linesPushed += orderData.lines.length;
        if (context && context.updatePushProgress) {
            context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
        }
    }
    
    if (rejected.length > 0) context.showRejectionModal(rejected);
    return pushedIds;
}
