import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { db } from '../auth.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from '../app.js';

export async function pushDeposits(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');

    const groups = {};
    data.forEach(t => {
        if (!t.category) throw new Error("Missing category mapping in Deposits.");
        const oId = t['order id'] || t.uid; 
        if (!groups[oId]) groups[oId] = { marketplace: t.marketplace, date: t['date/time'], settlementId: t['settlement id'], lines: [] };
        groups[oId].lines.push(t);
    });

    let pushedIds = [];
    let rejected = [];

    const totalLines = data.length;
    const totalTxns = Object.keys(groups).length;
    let txnsPushed = 0;
    let linesPushed = 0;
    const typeName = "deposit";

    for (const [orderId, groupData] of Object.entries(groups)) {
        const txnDate = groupData.date ? new Date(groupData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        const exactTimeMs = groupData.date ? new Date(groupData.date).getTime() : Date.now();

        let netAmount = 0;
        const qboLines = groupData.lines.map(line => {
            const amt = Math.abs(parseFloat(line.total || 0));
            netAmount += amt;
            return {
                "Amount": amt,
                "DetailType": "DepositLineDetail",
                "DepositLineDetail": { "AccountRef": { "name": line.category } },
                "Description": line.lineItem
            };
        });

        const signature = `DEP_${exactTimeMs}_${groupData.settlementId}_${netAmount.toFixed(2)}`;
        const ledgerRef = doc(db, "users", currentUser.uid, "qbo_sync_ledger", signature);
        const ledgerSnap = await getDoc(ledgerRef);
        
        if (ledgerSnap.exists()) {
            groupData.lines.forEach(l => rejected.push(l));
            txnsPushed++;
            linesPushed += groupData.lines.length;
            if (context && context.updatePushProgress) context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
            continue;
        }

        const payload = {
            "entityType": "Deposit",
            "realmId": config.realmId,
            "data": {
                "TxnDate": txnDate,
                "DepositToAccountRef": { "name": config.depositAccountName },
                "PrivateNote": `Order ID: ${orderId}`,
                "Line": qboLines
            }
        };

        const res = await pushQboEntity(payload);
        await setDoc(ledgerRef, { batchId: config.batchId, qboId: res.data.qboResponseId, timestamp: new Date().toISOString() });
        pushedIds.push({ type: "Deposit", id: res.data.qboResponseId });

        txnsPushed++;
        linesPushed += groupData.lines.length;
        if (context && context.updatePushProgress) {
            context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
        }
    }

    if (rejected.length > 0) context.showRejectionModal(rejected);
    return pushedIds;
}
