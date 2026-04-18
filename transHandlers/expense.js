import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { db } from '../auth.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from '../app.js';

export async function pushExpenses(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');
    
    // Group by Order ID
    const groups = {};
    data.forEach(t => {
        if (!t.category) throw new Error("Missing category mapping in Expenses.");
        const oId = t['order id'] || t.uid; 
        if (!groups[oId]) groups[oId] = { marketplace: t.marketplace, date: t['date/time'], settlementId: t['settlement id'], lines: [] };
        groups[oId].lines.push(t);
    });

    let pushedIds = [];
    let rejected = [];

    for (const [orderId, groupData] of Object.entries(groups)) {
        const vendorName = `${groupData.marketplace || 'Amazon'} Vendor`;
        const txnDate = groupData.date ? new Date(groupData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

        // 1. Calculate Net Amount for Duplicate Check
        let netAmount = 0;
        const qboLines = groupData.lines.map(line => {
            const amt = Math.abs(parseFloat(line.total || 0));
            netAmount += amt;
            return {
                "Amount": amt,
                "DetailType": "AccountBasedExpenseLineDetail",
                "AccountBasedExpenseLineDetail": { "AccountRef": { "name": line.category } },
                "Description": line.lineItem
            };
        });

        // 2. Duplicate Check
        const signature = `EXP_${txnDate}_${groupData.settlementId}_${netAmount.toFixed(2)}`;
        const ledgerRef = doc(db, "users", currentUser.uid, "qbo_sync_ledger", signature);
        const ledgerSnap = await getDoc(ledgerRef);
        
        if (ledgerSnap.exists()) {
            groupData.lines.forEach(l => rejected.push(l));
            continue;
        }

        // 3. Push to QBO
        const payload = {
            "entityType": "Purchase",
            "realmId": config.realmId,
            "data": {
                "TxnDate": txnDate,
                "PaymentType": "Cash",
                "AccountRef": { "name": config.depositAccountName },
                "EntityRef": { "name": vendorName },
                "PrivateNote": `Order ID: ${orderId}`,
                "Line": qboLines
            }
        };

        const res = await pushQboEntity(payload);
        
        // 4. Log to Ledger
        await setDoc(ledgerRef, { batchId: config.batchId, qboId: res.data.qboResponseId, timestamp: new Date().toISOString() });
        pushedIds.push({ type: "Purchase", id: res.data.qboResponseId });
    }

    if (rejected.length > 0) context.showRejectionModal(rejected);
    return pushedIds;
}
