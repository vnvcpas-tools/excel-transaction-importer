import { db, functions } from './auth.js'; 
import { collection, doc, getDoc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";
import { currentUser } from './app.js';

import { pushSalesReceipts } from './transHandlers/salesReceipt.js';
import { pushRefundReceipts } from './transHandlers/refundReceipt.js';
import { pushDeposits } from './transHandlers/deposit.js';
import { pushExpenses } from './transHandlers/expense.js';
import { pushPayouts } from './transHandlers/payout.js';

export default class Home {
    constructor() {
        this.transactions = [];
        this.categoriesDict = {};
        
        this.depositAccount = "Payments to Deposit"; 
        this.startDate = "";
        this.endDate = "";
        this.activeMainTab = "all";
        this.activeSubTab = "table";
    }

    async render() {
        return `
            <div class="container" style="padding-top: 1rem;">
                <h2 style="margin-top: 0; margin-bottom: 0.5rem; font-size: 1.5rem;">Transaction Importer (Amazon Date Range Report)</h2>
                <div id="alertBox" class="alert" style="margin-bottom: 0.5rem; padding: 0.5rem;"></div>

                <div id="pushStatusBar" style="background: #f8f9fa; border: 1px solid #dee2e6; border-left: 4px solid #3498db; padding: 0.5rem 1rem; margin-bottom: 0.5rem; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem;">
                    <span id="pushStatusText" style="font-weight: 500; color: #2c3e50;">Status: Ready to import</span>
                    <span id="limitText" style="color: #666;"></span>
                </div>

                <div class="control-panel" style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 1rem; padding: 0.75rem;">
                    <input type="file" id="csvFile" accept=".csv, .tsv" style="flex: 1; min-width: 200px;">
                    
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <label style="font-size: 0.8rem; font-weight: bold;">Filter Dates:</label>
                        <input type="date" id="startDate" title="Start Date">
                        <span>to</span>
                        <input type="date" id="endDate" title="End Date">
                    </div>

                    <input type="text" id="depositAccount" value="Payments to Deposit" placeholder="Offset Account" style="width: 200px;">
                    <button id="syncQboBtn" class="btn" disabled>Push Current View</button>
                    <button id="viewHistoryBtn" class="btn outline" style="background: white; color: #2c3e50; border: 1px solid #2c3e50;">View Batch History</button>
                </div>

                <div class="tabs main-tabs" style="border-bottom: 2px solid #3498db; margin-bottom: 0;">
                    <button class="tab active" data-maintab="all">All Data</button>
                    <button class="tab" data-maintab="sales">Sales Receipts (Orders)</button>
                    <button class="tab" data-maintab="refunds">Refund Receipts</button>
                    <button class="tab" data-maintab="expenses">Expenses</button>
                    <button class="tab" data-maintab="deposits">Deposits</button>
                    <button class="tab" data-maintab="payouts">Payouts (Transfers)</button>
                    <button class="tab" data-maintab="unmapped" style="color: var(--danger);">Unmapped Items</button>
                </div>

                <div class="tabs sub-tabs" style="background: #f8f9fa; padding-top: 5px; margin-bottom: 1rem;" id="subTabContainer">
                    <button class="tab active" data-subtab="table" style="font-size: 0.9rem; padding: 0.5rem 1rem;">Data Table View</button>
                    <button class="tab" data-subtab="journal" style="font-size: 0.9rem; padding: 0.5rem 1rem;">Summary Journal View</button>
                </div>

                <div id="tabContent">
                    <p style="padding: 2rem; text-align: center; color: #7f8c8d;">Upload an Amazon Date Range Report to begin.</p>
                </div>
            </div>

            <div id="historyModal" class="modal-overlay">
                <div class="modal-content" style="max-width: 900px;">
                    <h2 style="margin-top:0;">QBO Push History (Batches)</h2>
                    <p style="color: #666;">View and reverse recent transaction batches pushed to QuickBooks.</p>
                    <div id="historyTableContainer" style="margin: 1rem 0; max-height: 400px; overflow-y: auto;"></div>
                    <div style="text-align: right; margin-top: 1rem;">
                        <button class="btn outline" onclick="document.getElementById('historyModal').style.display='none'" style="color: black; border-color: #ccc;">Close</button>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        document.getElementById('limitText').innerText = currentUser ? 'Unlimited Uploads Enabled (Storage Active)' : 'Guest Limit: 10 Rows (Max 10 uploads/mo)';
        await this.loadCategories();
        
        document.getElementById('csvFile').addEventListener('change', e => this.handleFileSelect(e));
        document.getElementById('depositAccount').addEventListener('input', e => {
            this.depositAccount = e.target.value;
            if(this.activeSubTab === 'journal') this.renderActiveView();
        });

        document.getElementById('startDate').addEventListener('change', e => {
            this.startDate = e.target.value;
            this.renderActiveView();
        });
        document.getElementById('endDate').addEventListener('change', e => {
            this.endDate = e.target.value;
            this.renderActiveView();
        });

        document.getElementById('syncQboBtn').addEventListener('click', () => this.handlePushToQbo());
        
        document.getElementById('viewHistoryBtn').addEventListener('click', () => {
            if (!currentUser) return this.showAlert("You must be logged in to view history.", "warning");
            document.getElementById('historyModal').style.display = 'flex';
            this.loadBatchHistory();
        });

        document.querySelectorAll('.main-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.main-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeMainTab = e.target.dataset.maintab;
                
                if (this.activeMainTab === 'unmapped') {
                    document.getElementById('subTabContainer').style.display = 'none';
                } else {
                    document.getElementById('subTabContainer').style.display = 'flex';
                }
                
                this.renderActiveView();
            });
        });

        document.querySelectorAll('.sub-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.sub-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeSubTab = e.target.dataset.subtab;
                this.renderActiveView();
            });
        });

        window.deleteBatch = (batchId, realmId) => this.handleDeleteBatch(batchId, realmId);
    }

    renderActiveView() {
        if (this.transactions.length === 0) return;
        if (this.activeMainTab === 'unmapped') return this.renderUnmappedTable();
        if (this.activeSubTab === 'table') return this.renderTable();
        this.renderJournal();
    }

    getFilteredAndPartitionedData() {
        let data = this.transactions;

        if (this.startDate || this.endDate) {
            const startStr = this.startDate ? new Date(this.startDate).setHours(0,0,0,0) : 0;
            const endStr = this.endDate ? new Date(this.endDate).setHours(23,59,59,999) : Infinity;

            data = data.filter(t => {
                if (!t['date/time']) return true; 
                const tDate = new Date(t['date/time']).getTime();
                if (isNaN(tDate)) return true; 
                return tDate >= startStr && tDate <= endStr;
            });
        }

        if (this.activeMainTab === 'sales') {
            data = data.filter(t => t.type.toLowerCase() === 'order' && t.groupClass === 'receipt');
        } else if (this.activeMainTab === 'refunds') {
            data = data.filter(t => t.type.toLowerCase() === 'refund' && t.groupClass === 'receipt');
        } else if (this.activeMainTab === 'expenses') {
            data = data.filter(t => {
                const isOrderFee = (t.type.toLowerCase() === 'order' && t.groupClass === 'fee');
                const isGeneralExpense = (t.type.toLowerCase() !== 'order' && t.type.toLowerCase() !== 'refund' && t.type.toLowerCase() !== 'transfer' && parseFloat(t.total) < 0);
                return isOrderFee || isGeneralExpense;
            });
        } else if (this.activeMainTab === 'deposits') {
            data = data.filter(t => {
                const isRefundFee = (t.type.toLowerCase() === 'refund' && t.groupClass === 'fee');
                const isGeneralDeposit = (t.type.toLowerCase() !== 'order' && t.type.toLowerCase() !== 'refund' && t.type.toLowerCase() !== 'transfer' && parseFloat(t.total) >= 0);
                return isRefundFee || isGeneralDeposit;
            });
        } else if (this.activeMainTab === 'payouts') {
            data = data.filter(t => t.type.toLowerCase() === 'transfer');
        }

        return data;
    }

    async handlePushToQbo() {
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) return this.showAlert("Please connect and select a QBO account first.", "warning");

        const visibleData = this.getFilteredAndPartitionedData();
        if (visibleData.length === 0) return this.showAlert("No transactions in the current view to push.", "warning");

        const pushBtn = document.getElementById('syncQboBtn');
        const statusText = document.getElementById('pushStatusText');
        const originalText = pushBtn.innerText;
        
        pushBtn.innerText = "Provisioning & Pushing...";
        pushBtn.disabled = true;
        statusText.innerText = "Status: Provisioning & Pushing to QuickBooks...";
        statusText.style.color = "#e67e22"; 

        try {
            const config = {
                realmId: qboSelect.value,
                depositAccountName: this.depositAccount && this.depositAccount.trim() !== "" ? this.depositAccount : "Payments to Deposit",
                functions: functions,
                endDate: this.endDate,
                batchId: `batch_${Date.now()}` 
            };

            let pushedIds = [];

            if (this.activeSubTab === 'table') {
                if (this.activeMainTab === 'sales') pushedIds = await pushSalesReceipts(visibleData, config, this);
                else if (this.activeMainTab === 'refunds') pushedIds = await pushRefundReceipts(visibleData, config, this);
                else if (this.activeMainTab === 'deposits') pushedIds = await pushDeposits(visibleData, config, this);
                else if (this.activeMainTab === 'expenses') pushedIds = await pushExpenses(visibleData, config, this);
                else if (this.activeMainTab === 'payouts') pushedIds = await pushPayouts(visibleData, config, this);
                else throw new Error("Detailed sync is only available within specific tabs.");
            } else {
                pushedIds = await this.pushStandardJournalEntry(visibleData, config);
            }

            if (pushedIds && pushedIds.length > 0) {
                await setDoc(doc(db, "users", currentUser.uid, "transPushedToQB", config.batchId), {
                    timestamp: new Date().toISOString(),
                    realmId: config.realmId,
                    tab: this.activeMainTab,
                    view: this.activeSubTab,
                    qboIds: pushedIds
                });
            }
            
            statusText.innerText = "Status: Push completed successfully.";
            statusText.style.color = "#27ae60"; 

        } catch (error) {
            console.error("Push failed:", error);
            this.showAlert(error.message || "Failed to push to QBO. See console.", "danger");
            statusText.innerText = "Status: Push failed. Check alerts.";
            statusText.style.color = "#e74c3c";
        } finally {
            pushBtn.innerText = originalText;
            pushBtn.disabled = false;
        }
    }

    async pushStandardJournalEntry(visibleData, config) {
        const getOrCreateQboAccount = httpsCallable(config.functions, 'getOrCreateQboAccount');
        const pushJournalEntry = httpsCallable(config.functions, 'pushJournalEntry');

        let depId;
        const depResponse = await getOrCreateQboAccount({ accountName: config.depositAccountName, realmId: config.realmId, accountType: "Bank" });
        depId = depResponse.data.id;

        let pushedIds = [];

        if (this.activeMainTab === 'payouts') {
            for (const t of visibleData) {
                if (!t.category) throw new Error("Missing Categories: Please map all payout line items.");
                const amt = parseFloat(t.total || 0);
                if (amt === 0) continue;

                const catResponse = await getOrCreateQboAccount({ accountName: t.category, realmId: config.realmId });
                const qboId = catResponse.data.id;

                const individualLines = [];
                if (amt < 0) {
                    individualLines.push({ postingType: "Debit", amount: Math.abs(amt), qboAccountId: qboId, description: t.lineItem });
                    individualLines.push({ postingType: "Credit", amount: Math.abs(amt), qboAccountId: depId, description: "Payout Transfer Offset" });
                } else {
                    individualLines.push({ postingType: "Credit", amount: amt, qboAccountId: qboId, description: t.lineItem });
                    individualLines.push({ postingType: "Debit", amount: amt, qboAccountId: depId, description: "Payout Transfer Offset" });
                }

                const tDate = t['date/time'] ? new Date(t['date/time']).toISOString().split('T')[0] : null;
                const res = await pushJournalEntry({ realmId: config.realmId, lines: individualLines, txnDate: tDate, privateNote: `VilBooks Transfer ID: ${t['settlement id'] || 'Manual'}` });
                pushedIds.push({ type: "JournalEntry", id: res.data.qboResponseId });
            }
            this.showAlert(`Success! ${visibleData.length} Individual Payout Entries created in QBO.`, "success");
        } else {
            let summary = {};
            let netDeposit = 0;
            let missingCats = false;

            visibleData.forEach(t => {
                if (!t.category) missingCats = true;
                const amt = parseFloat(t.total || 0);
                const key = t.lineItem || "UNCATEGORIZED"; 
                if (!summary[key]) summary[key] = { amt: 0, catName: t.category };
                summary[key].amt += amt;
                netDeposit += amt;
            });

            if (missingCats) throw new Error("Missing Categories: Please map all line items before pushing.");

            const linesToPush = [];
            if (netDeposit > 0) {
                linesToPush.push({ postingType: "Debit", amount: netDeposit, qboAccountId: depId, description: `Total ${this.activeMainTab}` });
            } else if (netDeposit < 0) {
                linesToPush.push({ postingType: "Credit", amount: Math.abs(netDeposit), qboAccountId: depId, description: `Total ${this.activeMainTab}` });
            }

            for (const lineKey of Object.keys(summary)) {
                const amt = summary[lineKey].amt;
                if (amt === 0) continue;

                const catResponse = await getOrCreateQboAccount({ accountName: summary[lineKey].catName, realmId: config.realmId });
                if (amt < 0) linesToPush.push({ postingType: "Debit", amount: Math.abs(amt), qboAccountId: catResponse.data.id, description: lineKey });
                else linesToPush.push({ postingType: "Credit", amount: amt, qboAccountId: catResponse.data.id, description: lineKey });
            }

            let summaryDateStr = config.endDate;
            if (!summaryDateStr) {
                const dates = visibleData.map(t => new Date(t['date/time']).getTime()).filter(n => !isNaN(n));
                if (dates.length > 0) summaryDateStr = new Date(Math.max(...dates)).toISOString().split('T')[0];
            }

            const response = await pushJournalEntry({ realmId: config.realmId, lines: linesToPush, txnDate: summaryDateStr, privateNote: `Imported via VilBooks - Tab: ${this.activeMainTab.toUpperCase()}` });
            if (response.data.success) {
                this.showAlert(`Success! ${this.activeMainTab.toUpperCase()} Summary Journal Entry created in QBO.`, "success");
                pushedIds.push({ type: "JournalEntry", id: response.data.qboResponseId });
            }
        }
        return pushedIds;
    }

    async loadBatchHistory() {
        const container = document.getElementById('historyTableContainer');
        container.innerHTML = "<p>Loading history...</p>";

        try {
            const snap = await getDocs(collection(db, "users", currentUser.uid, "transPushedToQB"));
            let batches = [];
            snap.forEach(doc => batches.push({ id: doc.id, ...doc.data() }));
            batches.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

            if (batches.length === 0) {
                container.innerHTML = "<p>No batches pushed yet.</p>";
                return;
            }

            let html = `
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                    <thead style="background: #f8f9fa;">
                        <tr>
                            <th style="padding: 10px; border-bottom: 2px solid #ddd;">Date Pushed</th>
                            <th style="padding: 10px; border-bottom: 2px solid #ddd;">Tab / View</th>
                            <th style="padding: 10px; border-bottom: 2px solid #ddd;">Items Created</th>
                            <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align: center;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            batches.forEach(b => {
                const dateStr = new Date(b.timestamp).toLocaleString();
                const itemCount = b.qboIds ? b.qboIds.length : 0;
                
                html += `
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">
                            <strong>${dateStr}</strong><br>
                            <span style="font-size:0.75rem; color:#888;">${b.id}</span>
                        </td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee; text-transform: capitalize;">
                            ${b.tab} <span style="color:#aaa;">(${b.view})</span>
                        </td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">${itemCount}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">
                            <button onclick="window.deleteBatch('${b.id}', '${b.realmId}')" class="btn danger" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">Reverse / Delete</button>
                        </td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            container.innerHTML = html;

        } catch (error) {
            console.error("Failed to load history", error);
            container.innerHTML = `<p class="text-danger">Error loading batch history.</p>`;
        }
    }

    async handleDeleteBatch(batchId, realmId) {
        if (!confirm("Are you sure you want to delete this entire batch from QuickBooks? This cannot be undone.")) return;
        
        try {
            const deleteQboBatch = httpsCallable(functions, 'deleteQboBatch');
            document.getElementById('historyTableContainer').innerHTML = "<p>Deleting batch from QuickBooks... Please wait.</p>";
            
            const res = await deleteQboBatch({ batchId: batchId, realmId: realmId });
            
            alert(`Success: ${res.data.deletedCount} transactions were removed from QuickBooks.`);
            this.loadBatchHistory(); 
        } catch (err) {
            alert(`Failed to delete batch: ${err.message}`);
            this.loadBatchHistory(); 
        }
    }

    async loadCategories() {
        const snap = await getDocs(collection(db, "category"));
        snap.forEach(doc => { 
            this.categoriesDict[doc.id] = {
                category: doc.data().category,
                accountType: doc.data().accountType || "",
                description: doc.data().description || ""
            }; 
        });
    }

    showAlert(message, type = "warning") {
        const box = document.getElementById('alertBox');
        box.innerHTML = message;
        box.className = `alert alert-${type} visible`;
    }

    hideAlert() {
        document.getElementById('alertBox').className = "alert";
    }
    
    showRejectionModal(rejectedData) {
        const modal = document.getElementById('rejectionModal');
        const container = document.getElementById('rejectionTableContainer');
        const downloadBtn = document.getElementById('downloadRejectsBtn');
        
        let html = `
            <div class="table-responsive" style="max-height: 400px; border: 1px solid #ccc;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead style="background: #f8f9fa; position: sticky; top: 0;">
                    <tr>
                        <th style="padding: 8px; border-bottom: 1px solid #ddd; text-align: left;">Date</th>
                        <th style="padding: 8px; border-bottom: 1px solid #ddd; text-align: left;">Type</th>
                        <th style="padding: 8px; border-bottom: 1px solid #ddd; text-align: left;">Settlement ID</th>
                        <th style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        rejectedData.forEach(t => {
            html += `<tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${t['date/time'] || ''}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${t['type'] || ''}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${t['settlement id'] || ''}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${t.total || 0}</td>
            </tr>`;
        });
        
        html += `</tbody></table></div>`;
        container.innerHTML = html;
        
        downloadBtn.onclick = () => {
            const csv = Papa.unparse(rejectedData);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `rejected_duplicates_${Date.now()}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        modal.style.display = 'flex';
    }

    checkGuestLimits() {
        if (currentUser) return true;
        const currentMonth = new Date().getMonth();
        let limitData = JSON.parse(localStorage.getItem('guestLimits')) || { month: currentMonth, count: 0 };
        if (limitData.month !== currentMonth) limitData = { month: currentMonth, count: 0 };
        if (limitData.count >= 10) {
            this.showAlert("Monthly guest upload limit reached.", "warning");
            return false;
        }
        limitData.count += 1;
        localStorage.setItem('guestLimits', JSON.stringify(limitData));
        return true;
    }

    async handleFileSelect(e) {
        this.hideAlert();
        const file = e.target.files[0];
        if (!file) return;

        if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
            this.showAlert("<strong>Format Error:</strong> You uploaded an Excel workbook (.xlsx). Please save it as a <strong>CSV</strong> file before uploading.", "danger");
            e.target.value = "";
            return;
        }
        if (!this.checkGuestLimits()) { e.target.value = ""; return; }

        const fileDocRef = doc(db, "transactionFiles", file.name);
        const fileDocSnap = await getDoc(fileDocRef);
        if (fileDocSnap.exists()) {
            const uploadDate = new Date(fileDocSnap.data().dateTimeUploaded).toLocaleDateString();
            const proceed = confirm(`DUPLICATE WARNING: "${file.name}" was already uploaded on ${uploadDate}.\n\nProcess again?`);
            if (!proceed) { e.target.value = ""; return; }
        }

        this.parseFileAndLogRecord(file);
    }

    parseFileAndLogRecord(file) {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                await this.logFileRecord(file);
                this.parseData(results.data, true);
            }
        });
    }

    parseData(data, isNew) {
        if (!currentUser && data.length > 10) {
            data = data.slice(0, 10);
            this.showAlert("Guest mode: File truncated to first 10 transaction lines.", "info");
        }

        const expandedTransactions = [];
        
        const receiptColumns = [
            'product sales', 'product sales tax', 'shipping credits', 'shipping credits tax',
            'gift wrap credits', 'giftwrap credits tax', 'Regulatory Fee', 'Tax On Regulatory Fee'
        ];
        
        const feeColumns = [
            'promotional rebates', 'promotional rebates tax', 'marketplace withheld tax',
            'selling fees', 'fba fees'
        ];

        data.forEach(row => {
            const typeStr = (row['type'] || "").trim();
            const tLower = typeStr.toLowerCase();

            if (tLower === 'order' || tLower === 'refund') {
                const prefix = typeStr; 

                receiptColumns.forEach(colName => {
                    const amt = parseFloat(row[colName] || 0);
                    if (amt !== 0) {
                        const lineItemName = `${prefix} ${colName}`;
                        expandedTransactions.push({
                            ...row,
                            type: typeStr,
                            total: amt,
                            quantity: row['quantity'] || 1,
                            description: row['description'] || "",
                            lineItem: lineItemName,
                            category: (this.categoriesDict[lineItemName] || {}).category || "",
                            uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                            selected: false,
                            groupClass: 'receipt'
                        });
                    }
                });

                feeColumns.forEach(colName => {
                    const amt = parseFloat(row[colName] || 0);
                    if (amt !== 0) {
                        const lineItemName = `${prefix} ${colName}`;
                        expandedTransactions.push({
                            ...row,
                            type: typeStr,
                            total: amt,
                            quantity: row['quantity'] || 1,
                            description: row['description'] || "",
                            lineItem: lineItemName,
                            category: (this.categoriesDict[lineItemName] || {}).category || "",
                            uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                            selected: false,
                            groupClass: 'fee'
                        });
                    }
                });

            } else {
                let lineItem = `${typeStr} - ${row['description'] || ""}`.replace(/^ - | - $/g, '').trim();
                if (tLower === 'transfer') {
                    const commaIndex = lineItem.indexOf(',');
                    if (commaIndex !== -1) lineItem = lineItem.substring(0, commaIndex).trim();
                }

                const amt = parseFloat(row['total'] || 0);
                if (amt !== 0 || typeStr !== "") {
                    expandedTransactions.push({
                        ...row,
                        type: typeStr,
                        total: amt,
                        quantity: 1,
                        description: row['description'] || "",
                        lineItem: lineItem,
                        category: (this.categoriesDict[lineItem] || {}).category || "",
                        uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                        selected: false,
                        groupClass: 'general'
                    });
                }
            }
        });

        this.transactions = expandedTransactions;
        document.getElementById('syncQboBtn').disabled = false;
        
        const statusText = document.getElementById('pushStatusText');
        statusText.innerText = `Status: ${expandedTransactions.length} transactions ready to push`;
        statusText.style.color = "#2c3e50";
        
        this.renderActiveView();
    }

    async logFileRecord(file) {
        let status = "Local Render Only";
        if (currentUser && db.app) {
            try {
                const storage = getStorage(db.app);
                const fileRef = ref(storage, `transactions/${file.name}`);
                await uploadBytes(fileRef, file);
                status = "Uploaded to Storage";
            } catch (e) {
                status = "Storage Failed - Bypass Used";
            }
        }
        try {
            await setDoc(doc(db, "transactionFiles", file.name), {
                dateTimeUploaded: new Date().toISOString(),
                uploadedBy: currentUser ? currentUser.email : "Guest",
                storageStatus: status
            });
        } catch (e) {}
    }

    async updateCategory(lineItem, newCategory) {
        if(!newCategory || newCategory.trim() === "") return;
        try {
            await setDoc(doc(db, "category", lineItem), { lineItem: lineItem, category: newCategory }, { merge: true });
            
            if (!this.categoriesDict[lineItem]) this.categoriesDict[lineItem] = {};
            this.categoriesDict[lineItem].category = newCategory;
            
            this.transactions.forEach(t => { if(t.lineItem === lineItem) t.category = newCategory; });
            this.renderActiveView(); 
        } catch (e) { alert("Error updating category database."); }
    }

    renderTable() {
        const currentData = this.getFilteredAndPartitionedData();
        
        let html = `
            <div style="margin-bottom: 10px; display:flex; justify-content:space-between; align-items:center;">
                <button class="btn danger" onclick="window.deleteSelected()">Delete Selected Rows</button>
                <span style="font-size:0.9rem; color:#666;">Showing ${currentData.length} rows</span>
            </div>
            <div class="table-responsive">
            <table><thead><tr>
                <th style="width: 40px;"><input type="checkbox" id="selectAllCb" onchange="window.toggleSelectAll(this.checked)"></th>
                <th>Transaction Type</th>
                <th>Line Item</th>
                <th>Category</th>
                <th>Description</th>
                <th>SKU</th>
                <th style="text-align: right;">Qty</th>
                <th style="text-align: right;">Amount</th>
                <th>Date/Time</th>
                <th>Settlement ID</th>
                <th>Order ID</th>
            </tr></thead><tbody>
        `;

        if (currentData.length === 0) {
            html += `<tr><td colspan="11" style="text-align:center;">No data matches the current filters.</td></tr>`;
        }

        currentData.forEach((t) => {
            let catDisplay = t.category;
            if (!t.category) {
                catDisplay = `<input type="text" class="cat-input" placeholder="Add Category..." onblur="window.updateCat('${t.lineItem}', this.value)"><span class="text-danger"> Missing</span>`;
            }

            html += `<tr>
                <td><input type="checkbox" class="row-checkbox" data-uid="${t.uid}" ${t.selected ? 'checked' : ''} onchange="window.toggleRow('${t.uid}', this.checked)"></td>
                <td>${t['type'] || ''}</td>
                <td><strong>${t.lineItem}</strong></td>
                <td>${catDisplay}</td>
                <td><span style="font-size: 0.8rem; color: #555;">${t.description || ''}</span></td>
                <td>${t['sku'] || ''}</td>
                <td style="text-align: right;">${t.quantity || 1}</td>
                <td style="text-align: right; font-weight: bold;">${parseFloat(t.total).toFixed(2)}</td>
                <td>${t['date/time'] || ''}</td>
                <td>${t['settlement id'] || ''}</td>
                <td>${t['order id'] || ''}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;

        window.updateCat = (line, val) => this.updateCategory(line, val);
        
        window.toggleSelectAll = (checked) => {
            currentData.forEach(t => {
                const masterRow = this.transactions.find(m => m.uid === t.uid);
                if (masterRow) masterRow.selected = checked;
            });
            document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = checked);
        };
        
        window.toggleRow = (uid, checked) => {
            const masterRow = this.transactions.find(t => t.uid === uid);
            if (masterRow) masterRow.selected = checked;
            const allChecked = currentData.length > 0 && currentData.every(t => t.selected);
            const selectAllCb = document.getElementById('selectAllCb');
            if (selectAllCb) selectAllCb.checked = allChecked;
        };

        window.deleteSelected = () => {
            this.transactions = this.transactions.filter(t => !t.selected);
            this.renderActiveView();
        };
    }

    renderUnmappedTable() {
        const unmappedData = [];
        const seen = new Set();
        
        this.transactions.forEach(t => {
            if (!t.category && !seen.has(t.lineItem)) {
                seen.add(t.lineItem);
                unmappedData.push(t);
            }
        });

        let html = `
            <div style="margin-bottom: 10px;">
                <span style="font-size:0.9rem; color:#666;">Showing ${unmappedData.length} unique unmapped line items.</span>
            </div>
            <div class="table-responsive">
            <table><thead><tr>
                <th>Line Item</th>
                <th>Category Name (QBO Account)</th>
                <th>Account Type</th>
                <th>Description</th>
                <th style="text-align:center;">Action</th>
            </tr></thead><tbody>
        `;

        if (unmappedData.length === 0) {
            html += `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: #27ae60; font-weight: bold;">All line items are successfully mapped!</td></tr>`;
        }

        unmappedData.forEach((t, i) => {
            html += `<tr>
                <td><strong>${t.lineItem}</strong></td>
                <td><input type="text" id="unmap-cat-${i}" placeholder="E.g., Product Sales, FBA Fees..." style="padding:0.4rem; width:100%; box-sizing: border-box;"></td>
                <td>
                    <select id="unmap-type-${i}" style="padding:0.4rem; width:100%; box-sizing: border-box;">
                        <option value="Income">Income</option>
                        <option value="Expense" selected>Expense</option>
                        <option value="Bank">Bank / Clearing</option>
                        <option value="OtherCurrentAsset">Other Current Asset</option>
                        <option value="CostOfGoodsSold">Cost of Goods Sold</option>
                    </select>
                </td>
                <td><input type="text" id="unmap-desc-${i}" placeholder="Optional internal description" style="padding:0.4rem; width:100%; box-sizing: border-box;"></td>
                <td style="text-align:center;">
                    <button class="btn" onclick="window.pushAndSaveUnmapped('${t.lineItem}', ${i})">Push to QBO & Save</button>
                </td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;

        window.pushAndSaveUnmapped = async (lineItem, index) => {
            const catVal = document.getElementById(`unmap-cat-${index}`).value.trim();
            const typeVal = document.getElementById(`unmap-type-${index}`).value;
            const descVal = document.getElementById(`unmap-desc-${index}`).value.trim();
            const btn = event.target;

            if (!catVal) { 
                this.showAlert("Please enter a Category Name (QBO Account Name).", "danger"); 
                return; 
            }
            
            const qboSelect = document.getElementById('qboSelect');
            if (!qboSelect || !qboSelect.value) {
                this.showAlert("Please connect and select a QBO account from the top menu first.", "warning");
                return;
            }

            btn.innerText = "Pushing...";
            btn.disabled = true;

            try {
                const getOrCreateQboAccount = httpsCallable(functions, 'getOrCreateQboAccount');
                
                await getOrCreateQboAccount({
                    accountName: catVal,
                    realmId: qboSelect.value,
                    accountType: typeVal,
                    description: descVal
                });

                await setDoc(doc(db, "category", lineItem), {
                    lineItem: lineItem,
                    category: catVal,
                    accountType: typeVal,
                    description: descVal
                }, { merge: true });

                if (!this.categoriesDict[lineItem]) this.categoriesDict[lineItem] = {};
                this.categoriesDict[lineItem].category = catVal;
                this.categoriesDict[lineItem].accountType = typeVal;
                
                this.transactions.forEach(t => {
                    if (t.lineItem === lineItem) t.category = catVal;
                });

                this.showAlert(`Successfully created "${catVal}" as ${typeVal} in QBO and mapped it!`, "success");
                this.renderActiveView(); 

            } catch (err) {
                this.showAlert(err.message, "danger");
                btn.innerText = "Push to QBO & Save";
                btn.disabled = false;
            }
        };
    }

    renderJournal() {
        const currentData = this.getFilteredAndPartitionedData();

        if (currentData.length === 0) {
            let html = `
                <div class="table-responsive">
                <table><thead><tr>
                    <th>Account / Category</th>
                    <th style="text-align: right;">Debit</th>
                    <th style="text-align: right;">Credit</th>
                    <th>Line Description</th>
                </tr></thead><tbody>
                <tr><td colspan="4" style="text-align:center;">No data matches the current filters.</td></tr>
                </tbody></table></div>`;
            document.getElementById('tabContent').innerHTML = html;
            return;
        }

        const depName = this.depositAccount && this.depositAccount.trim() !== "" ? this.depositAccount : "Payments to Deposit";
        let html = `<div class="table-responsive">`;

        if (this.activeMainTab === 'payouts') {
            html += `
                <table><thead><tr>
                    <th>Account / Category</th>
                    <th style="text-align: right;">Debit</th>
                    <th style="text-align: right;">Credit</th>
                    <th>Line Description</th>
                </tr></thead><tbody>
            `;

            currentData.forEach(t => {
                const amt = parseFloat(t.total || 0);
                if (amt === 0) return;

                const tDate = t['date/time'] ? new Date(t['date/time']).toLocaleDateString() : 'Unknown Date';
                const catRef = t.category || `<span class="text-danger">Missing</span>`;
                const absAmt = Math.abs(amt).toFixed(2);

                html += `<tr style="background:#e9ecef;"><td colspan="4"><strong>Date: ${tDate}</strong> (Settlement ID: ${t['settlement id'] || 'N/A'})</td></tr>`;

                if (amt < 0) {
                    html += `<tr><td>${catRef}</td><td style="text-align: right;">${absAmt}</td><td></td><td>${t.lineItem}</td></tr>`;
                    html += `<tr style="background:#f8f9fa;"><td><strong>${depName}</strong></td><td></td><td style="text-align: right;">${absAmt}</td><td>Payout Transfer Offset</td></tr>`;
                } else {
                    html += `<tr style="background:#f8f9fa;"><td><strong>${depName}</strong></td><td style="text-align: right;">${absAmt}</td><td></td><td>Payout Transfer Offset</td></tr>`;
                    html += `<tr><td>${catRef}</td><td></td><td style="text-align: right;">${absAmt}</td><td>${t.lineItem}</td></tr>`;
                }
            });

            html += `</tbody></table></div>`;
            document.getElementById('tabContent').innerHTML = html;

        } else {
            let summary = {};
            let netDeposit = 0;

            currentData.forEach(t => {
                const amt = parseFloat(t.total || 0);
                const key = t.lineItem || "UNCATEGORIZED"; 
                if (!summary[key]) summary[key] = { amt: 0, catName: t.category || `<span class="text-danger">Missing</span>` };
                summary[key].amt += amt;
                netDeposit += amt;
            });

            let summaryDateStr = this.endDate;
            if (!summaryDateStr) {
                const dates = currentData.map(t => new Date(t['date/time']).getTime()).filter(n => !isNaN(n));
                if (dates.length > 0) {
                    summaryDateStr = new Date(Math.max(...dates)).toLocaleDateString();
                } else {
                    summaryDateStr = "N/A";
                }
            } else {
                summaryDateStr = new Date(this.endDate + "T00:00:00").toLocaleDateString();
            }

            html += `
                <h4 style="margin-top: 0; margin-bottom: 10px; color: #2c3e50;">Journal Entry Date: <span style="font-weight: normal;">${summaryDateStr}</span></h4>
                <table><thead><tr>
                    <th>Account / Category</th>
                    <th style="text-align: right;">Debit</th>
                    <th style="text-align: right;">Credit</th>
                    <th>Line Description</th>
                </tr></thead><tbody>
            `;

            let journalLines = [];
            if (netDeposit > 0) {
                journalLines.push({ catName: `<strong>${depName}</strong>`, debit: netDeposit, credit: 0, desc: `Total ${this.activeMainTab}`, isDeposit: true });
            } else if (netDeposit < 0) {
                journalLines.push({ catName: `<strong>${depName}</strong>`, debit: 0, credit: Math.abs(netDeposit), desc: `Total ${this.activeMainTab}`, isDeposit: true });
            }

            let totalDebit = netDeposit > 0 ? netDeposit : 0;
            let totalCredit = netDeposit < 0 ? Math.abs(netDeposit) : 0;

            Object.keys(summary).forEach(lineKey => {
                const amt = summary[lineKey].amt;
                if (amt < 0) {
                    journalLines.push({ catName: summary[lineKey].catName, debit: Math.abs(amt), credit: 0, desc: lineKey, isDeposit: false });
                    totalDebit += Math.abs(amt);
                } else if (amt > 0) {
                    journalLines.push({ catName: summary[lineKey].catName, debit: 0, credit: amt, desc: lineKey, isDeposit: false });
                    totalCredit += amt;
                }
            });

            journalLines.sort((a, b) => {
                if (a.isDeposit && a.debit > 0) return -1;
                if (b.isDeposit && b.debit > 0) return 1;
                if (a.isDeposit && a.credit > 0) return 1;
                if (b.isDeposit && b.credit > 0) return -1;
                return a.debit > 0 ? -1 : 1; 
            });

            journalLines.forEach(line => {
                const debitStr = line.debit > 0 ? line.debit.toFixed(2) : "";
                const creditStr = line.credit > 0 ? line.credit.toFixed(2) : "";
                html += `<tr><td>${line.catName}</td><td style="text-align: right;">${debitStr}</td><td style="text-align: right;">${creditStr}</td><td>${line.desc}</td></tr>`;
            });

            html += `<tr style="font-weight:bold; background:#e9ecef">
                <td>TOTAL</td>
                <td style="text-align: right;">${totalDebit.toFixed(2)}</td>
                <td style="text-align: right;">${totalCredit.toFixed(2)}</td>
                <td></td>
            </tr>`;

            html += `</tbody></table></div>`;
            document.getElementById('tabContent').innerHTML = html;
        }
    }
}
