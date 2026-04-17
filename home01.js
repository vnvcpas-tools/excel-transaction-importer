import { db, functions } from './auth.js'; 
import { collection, doc, getDoc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";
import { currentUser } from './app.js';

// Import our new modular transaction handlers
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
            <div class="container">
                <h2>Transaction Importer (Amazon Date Range Report)</h2>
                <div id="alertBox" class="alert"></div>

                <div class="control-panel" style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 1rem;">
                    <input type="file" id="csvFile" accept=".csv, .tsv" style="flex: 1; min-width: 200px;">
                    
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <label style="font-size: 0.8rem; font-weight: bold;">Filter Dates:</label>
                        <input type="date" id="startDate" title="Start Date">
                        <span>to</span>
                        <input type="date" id="endDate" title="End Date">
                    </div>

                    <input type="text" id="depositAccount" value="Payments to Deposit" placeholder="Offset Account" style="width: 200px;">
                    <button id="syncQboBtn" class="btn" disabled>Push Current View to QBO</button>
                </div>
                <div style="text-align: right; margin-bottom: 1rem;"><span style="font-size: 0.9rem; color: #666;" id="limitText"></span></div>

                <div class="tabs main-tabs" style="border-bottom: 2px solid #3498db; margin-bottom: 0;">
                    <button class="tab active" data-maintab="all">All Data</button>
                    <button class="tab" data-maintab="sales">Sales Receipts (Orders)</button>
                    <button class="tab" data-maintab="refunds">Refund Receipts</button>
                    <button class="tab" data-maintab="expenses">Expenses (< 0)</button>
                    <button class="tab" data-maintab="deposits">Deposits (> 0)</button>
                    <button class="tab" data-maintab="payouts">Payouts (Transfers)</button>
                </div>

                <div class="tabs sub-tabs" style="background: #f8f9fa; padding-top: 5px; margin-bottom: 1rem;">
                    <button class="tab active" data-subtab="table" style="font-size: 0.9rem; padding: 0.5rem 1rem;">Data Table View</button>
                    <button class="tab" data-subtab="journal" style="font-size: 0.9rem; padding: 0.5rem 1rem;">Summary Journal View</button>
                </div>

                <div id="tabContent">
                    <p style="padding: 2rem; text-align: center; color: #7f8c8d;">Upload an Amazon Date Range Report to begin.</p>
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

        document.querySelectorAll('.main-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.main-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeMainTab = e.target.dataset.maintab;
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
    }

    renderActiveView() {
        if (this.transactions.length === 0) return;
        if (this.activeSubTab === 'table') {
            this.renderTable();
        } else {
            this.renderJournal();
        }
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
            data = data.filter(t => (t['type'] || "").toLowerCase() === 'order');
        } else if (this.activeMainTab === 'refunds') {
            data = data.filter(t => (t['type'] || "").toLowerCase() === 'refund');
        } else if (this.activeMainTab === 'payouts') {
            data = data.filter(t => (t['type'] || "").toLowerCase() === 'transfer');
        } else if (this.activeMainTab === 'expenses') {
            data = data.filter(t => {
                const type = (t['type'] || "").toLowerCase();
                const amt = parseFloat(t.total || 0);
                return type !== 'order' && type !== 'refund' && type !== 'transfer' && amt < 0;
            });
        } else if (this.activeMainTab === 'deposits') {
            data = data.filter(t => {
                const type = (t['type'] || "").toLowerCase();
                const amt = parseFloat(t.total || 0);
                return type !== 'order' && type !== 'refund' && type !== 'transfer' && amt >= 0;
            });
        }

        return data;
    }

    async handlePushToQbo() {
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) {
            this.showAlert("Please connect and select a QBO account first.", "warning");
            return;
        }

        const visibleData = this.getFilteredAndPartitionedData();

        if (visibleData.length === 0) {
            this.showAlert("No transactions in the current view to push.", "warning");
            return;
        }

        const pushBtn = document.getElementById('syncQboBtn');
        const originalText = pushBtn.innerText;
        pushBtn.innerText = "Provisioning & Pushing...";
        pushBtn.disabled = true;

        try {
            const config = {
                realmId: qboSelect.value,
                depositAccountName: this.depositAccount && this.depositAccount.trim() !== "" ? this.depositAccount : "Payments to Deposit",
                functions: functions,
                endDate: this.endDate
            };

            // Route to specific modular handlers based on the active view
            if (this.activeSubTab === 'table') {
                if (this.activeMainTab === 'sales') {
                    await pushSalesReceipts(visibleData, config, this);
                } else if (this.activeMainTab === 'refunds') {
                    await pushRefundReceipts(visibleData, config, this);
                } else if (this.activeMainTab === 'deposits') {
                    await pushDeposits(visibleData, config, this);
                } else if (this.activeMainTab === 'expenses') {
                    await pushExpenses(visibleData, config, this);
                } else if (this.activeMainTab === 'payouts') {
                    await pushPayouts(visibleData, config, this);
                } else {
                    throw new Error("Detailed sync is only available within specific tabs (Sales, Refunds, Expenses, Deposits, Payouts).");
                }
            } else {
                // If Journal View, push a standard Journal Entry
                await this.pushStandardJournalEntry(visibleData, config);
            }

        } catch (error) {
            console.error("Push failed:", error);
            this.showAlert(error.message || "Failed to push to QBO. See console.", "danger");
        } finally {
            pushBtn.innerText = originalText;
            pushBtn.disabled = false;
        }
    }

    async pushStandardJournalEntry(visibleData, config) {
        const getOrCreateQboAccount = httpsCallable(config.functions, 'getOrCreateQboAccount');
        const pushJournalEntry = httpsCallable(config.functions, 'pushJournalEntry');

        let depId;
        const depResponse = await getOrCreateQboAccount({ accountName: config.depositAccountName, realmId: config.realmId });
        depId = depResponse.data.id;

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
                await pushJournalEntry({ realmId: config.realmId, lines: individualLines, txnDate: tDate, privateNote: `VilBooks Transfer ID: ${t['settlement id'] || 'Manual'}` });
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
                const catName = summary[lineKey].catName;
                if (amt === 0) continue;

                const catResponse = await getOrCreateQboAccount({ accountName: catName, realmId: config.realmId });
                const qboId = catResponse.data.id;

                if (amt < 0) {
                    linesToPush.push({ postingType: "Debit", amount: Math.abs(amt), qboAccountId: qboId, description: lineKey });
                } else if (amt > 0) {
                    linesToPush.push({ postingType: "Credit", amount: amt, qboAccountId: qboId, description: lineKey });
                }
            }

            let summaryDateStr = config.endDate;
            if (!summaryDateStr) {
                const dates = visibleData.map(t => new Date(t['date/time']).getTime()).filter(n => !isNaN(n));
                if (dates.length > 0) {
                    summaryDateStr = new Date(Math.max(...dates)).toISOString().split('T')[0];
                }
            }

            const response = await pushJournalEntry({ realmId: config.realmId, lines: linesToPush, txnDate: summaryDateStr, privateNote: `Imported via VilBooks - Tab: ${this.activeMainTab.toUpperCase()}` });
            if (response.data.success) {
                this.showAlert(`Success! ${this.activeMainTab.toUpperCase()} Summary Journal Entry created in QBO.`, "success");
            }
        }
    }

    async loadCategories() {
        const snap = await getDocs(collection(db, "category"));
        snap.forEach(doc => { this.categoriesDict[doc.id] = doc.data().category; });
    }

    showAlert(message, type = "warning") {
        const box = document.getElementById('alertBox');
        box.innerHTML = message;
        box.className = `alert alert-${type} visible`;
    }

    hideAlert() {
        document.getElementById('alertBox').className = "alert";
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
        const targetColumns = [
            'product sales', 'product sales tax', 'shipping credits', 'shipping credits tax',
            'gift wrap credits', 'giftwrap credits tax', 'Regulatory Fee', 'Tax On Regulatory Fee',
            'promotional rebates', 'promotional rebates tax', 'marketplace withheld tax',
            'selling fees', 'fba fees'
        ];

        data.forEach(row => {
            const typeStr = (row['type'] || "").trim();
            const tLower = typeStr.toLowerCase();

            if (tLower === 'order' || tLower === 'refund') {
                targetColumns.forEach(colName => {
                    const amt = parseFloat(row[colName] || 0);
                    if (amt !== 0) {
                        expandedTransactions.push({
                            ...row,
                            total: amt,
                            quantity: row['quantity'] || 1,
                            description: row['description'] || "",
                            lineItem: colName,
                            category: this.categoriesDict[colName] || "",
                            uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                            selected: false
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
                        total: amt,
                        quantity: 1,
                        description: row['description'] || "",
                        lineItem: lineItem,
                        category: this.categoriesDict[lineItem] || "",
                        uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                        selected: false
                    });
                }
            }
        });

        this.transactions = expandedTransactions;
        document.getElementById('syncQboBtn').disabled = false;
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
            await setDoc(doc(db, "category", lineItem), { lineItem: lineItem, category: newCategory });
            this.categoriesDict[lineItem] = newCategory;
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

        // === PAYOUTS TAB (Individual Entries) ===
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

        // === SUMMARY TABS ===
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
