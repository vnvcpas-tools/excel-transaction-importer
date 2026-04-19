import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { db } from '../auth.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from '../app.js';

export async function pushRefundReceipts(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');
    
    const refunds = {};
    data.forEach(t => {
        if (!t.category) throw new Error("Missing category mapping in Refunds.");
        const oId = t['order id'] || t.uid;
        const dateStamp = t['date/time'] || 'nodate';
        const settlementId = t['settlement id'] || 'nosettlement';
        const groupKey = `${oId}_${dateStamp}_${settlementId}`;

        if (!refunds[groupKey]) refunds[groupKey] = { orderId: oId, marketplace: t.marketplace, date: t['date/time'], settlementId: t['settlement id'], lines: [] };
        refunds[groupKey].lines.push(t);
    });

    let pushedIds = [];
    let rejected = [];

    const totalLines = data.length;
    const totalTxns = Object.keys(refunds).length;
    let txnsPushed = 0;
    let linesPushed = 0;
    const typeName = "refund receipt";

    for (const [groupKey, refundData] of Object.entries(refunds)) {
        const orderId = refundData.orderId;
        const customerName = `${refundData.marketplace || 'Amazon'} Customer`;
        
        const txnDate = refundData.date ? new Date(refundData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        const exactTimeMs = refundData.date ? new Date(refundData.date).getTime() : Date.now();

        let netAmount = 0;
        const qboLines = refundData.lines.map((line, index) => {
            const amt = parseFloat(line.total || 0) * -1; 
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

        const signature = `REFUND_${exactTimeMs}_${refundData.settlementId}_${netAmount.toFixed(2)}`;
        const ledgerRef = doc(db, "users", currentUser.uid, "qbo_sync_ledger", signature);
        const ledgerSnap = await getDoc(ledgerRef);
        
        if (ledgerSnap.exists()) {
            refundData.lines.forEach(l => rejected.push(l));
            txnsPushed++;
            linesPushed += refundData.lines.length;
            if (context && context.updatePushProgress) context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
            continue; 
        }

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

        const res = await pushQboEntity(payload);
        await setDoc(ledgerRef, { batchId: config.batchId, qboId: res.data.qboResponseId, timestamp: new Date().toISOString() });
        pushedIds.push({ type: "RefundReceipt", id: res.data.qboResponseId });

        txnsPushed++;
        linesPushed += refundData.lines.length;
        if (context && context.updatePushProgress) {
            context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
        }
    }

    if (rejected.length > 0) context.showRejectionModal(rejected);
    return pushedIds;
}
