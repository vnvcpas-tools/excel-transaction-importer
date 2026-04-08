import { db, functions } from './auth.js'; 
import { collection, doc, getDoc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { currentUser } from './app.js';

export default class Home {
    constructor() {
        this.transactions = [];
        this.categoriesDict = {};
        this.depositAccount = "";
    }

    async render() {
        return `
            <div class="container">
                <h2>Transaction Importer (Storage Bypass Mode)</h2>
                <div id="alertBox" class="alert"></div>

                <div class="control-panel">
                    <input type="file" id="csvFile" accept=".csv, .tsv">
                    <input type="text" id="depositAccount" placeholder="Deposit Account (e.g., Checking)">
                    <button id="syncQboBtn" class="btn" disabled>Push to QBO</button>
                    <span style="margin-left:auto; font-size: 0.9rem; color: #666;" id="limitText"></span>
                </div>

                <div class="tabs">
                    <button class="tab active" data-tab="transactions">Transactions</button>
                    <button class="tab" data-tab="journal">Journal Entry</button>
                </div>

                <div id="tabContent">
                    <p style="padding: 2rem; text-align: center; color: #7f8c8d;">Upload an Excel/CSV file to begin.</p>
                </div>
            </div>
        `;
    }

    async afterRender() {
        document.getElementById('limitText').innerText = currentUser ? 'Unlimited Uploads Enabled' : 'Guest Limit: 10 Rows (Max 10 uploads/mo)';
        await this.loadCategories();
        
        document.getElementById('csvFile').addEventListener('change', e => this.handleFileSelect(e));
        document.getElementById('depositAccount').addEventListener('input', e => {
            this.depositAccount = e.target.value;
            if(document.querySelector('.tab.active').dataset.tab === 'journal') this.renderJournal();
        });

        // Attach the Push to QBO event listener
        document.getElementById('syncQboBtn').addEventListener('click', () => this.handlePushToQbo());

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                if(e.target.dataset.tab === 'transactions') this.renderTable();
                else this.renderJournal();
            });
        });
    }

    async handlePushToQbo() {
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) {
            this.showAlert("Please connect and select a QBO account first.", "warning");
            return;
        }

        if (this.transactions.length === 0) {
            this.showAlert("No transactions to push.", "warning");
            return;
        }

        const pushBtn = document.getElementById('syncQboBtn');
        const originalText = pushBtn.innerText;
        pushBtn.innerText = "Provisioning Accounts & Pushing...";
        pushBtn.disabled = true;

        try {
            let summary = {};
            let netDeposit = 0;
            let missingCats = false;

            // Re-aggregate the data just like the Journal tab does
            this.transactions.forEach(t => {
                if (!t.category) missingCats = true;
                const amt = parseFloat(t.amount || 0);
                const key = t.category || "UNCATEGORIZED";
                if (!summary[key]) summary[key] = 0;
                summary[key] += amt;
                netDeposit += amt;
            });

            if (missingCats) {
                throw new Error("Missing Categories: Please map all line items before pushing.");
            }

            const linesToPush = [];
            const depName = this.depositAccount && this.depositAccount.trim() !== "" ? this.depositAccount : "Checking";
            const realmId = qboSelect.value;
            const getOrCreateQboAccount = httpsCallable(functions, 'getOrCreateQboAccount');

            // 1. Get or Create the Deposit Account
            let depId;
            try {
                const depResponse = await getOrCreateQboAccount({ accountName: depName, realmId: realmId });
                depId = depResponse.data.id;
            } catch (err) {
                throw new Error(`Failed to provision deposit account "${depName}".`);
            }

            // Queue the Deposit Account
            if (netDeposit > 0) {
                linesToPush.push({ postingType: "Debit", amount: netDeposit, qboAccountId: depId, description: "Total Deposit" });
            } else if (netDeposit < 0) {
                linesToPush.push({ postingType: "Credit", amount: Math.abs(netDeposit), qboAccountId: depId, description: "Total Withdrawal" });
            }

            // 2. Queue the Categories (Auto-Provisioning them one by one)
            for (const cat of Object.keys(summary)) {
                const amt = summary[cat];
                if (amt === 0) continue;

                let qboId;
                try {
                    const catResponse = await getOrCreateQboAccount({ accountName: cat, realmId: realmId });
                    qboId = catResponse.data.id;
                } catch (err) {
                    throw new Error(`Failed to provision category account "${cat}".`);
                }

                if (amt < 0) {
                    linesToPush.push({ postingType: "Debit", amount: Math.abs(amt), qboAccountId: qboId, description: cat });
                } else if (amt > 0) {
                    linesToPush.push({ postingType: "Credit", amount: amt, qboAccountId: qboId, description: cat });
                }
            }

            // 3. Fire it off to the Cloud Function
            const pushJournalEntry = httpsCallable(functions, 'pushJournalEntry');
            const response = await pushJournalEntry({
                realmId: realmId,
                lines: linesToPush,
                privateNote: "Imported via Excel Transaction Importer"
            });

            if (response.data.success) {
                this.showAlert(`Success! Journal Entry created in QBO (ID: ${response.data.qboResponseId})`, "success");
            }

        } catch (error) {
            console.error("Push failed:", error);
            this.showAlert(error.message || "Failed to push to QBO. See console.", "danger");
        } finally {
            pushBtn.innerText = originalText;
            pushBtn.disabled = false;
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

    calculateLineItem(row) {
        const tType = row['transaction-type'] || "";
        const aType = row['amount-type'] || "";
        const desc = row['amount-description'] || "";
        const middle = (aType === tType) ? "" : aType;
        return `${tType} ${middle} ${desc}`.replace(/\s+/g, ' ').trim();
    }

    checkGuestLimits() {
        if (currentUser) return true;
        
        const currentMonth = new Date().getMonth();
        let limitData = JSON.parse(localStorage.getItem('guestLimits')) || { month: currentMonth, count: 0 };
        
        if (limitData.month !== currentMonth) {
            limitData = { month: currentMonth, count: 0 };
        }
        
        if (limitData.count >= 10) {
            this.showAlert("Monthly guest upload limit reached (10 uploads). Please login as Admin.", "warning");
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

        if (!this.checkGuestLimits()) {
            e.target.value = "";
            return;
        }

        // Check Firestore to see if this filename was processed before
        const fileDocRef = doc(db, "transactionFiles", file.name);
        const fileDocSnap = await getDoc(fileDocRef);

        if (fileDocSnap.exists()) {
            const uploadDate = new Date(fileDocSnap.data().dateTimeUploaded).toLocaleDateString();
            const proceed = confirm(`DUPLICATE WARNING: A file named "${file.name}" was already uploaded on ${uploadDate}.\n\nAre you sure you want to process this again? It may result in duplicate entries in QuickBooks.\n\nClick OK to process anyway, or Cancel to abort.`);
            
            if (!proceed) {
                e.target.value = ""; 
                return;
            }
            this.showAlert(`Warning: Processing a previously uploaded file (${file.name}). Ensure you are not creating duplicates in QuickBooks.`, "info");
        }

        // Proceed to parse the local file (Bypasses Storage)
        this.parseFileAndLogRecord(file);
    }

    parseFileAndLogRecord(file) {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                // Log the filename to Firestore so we know it was processed
                await this.logFileRecord(file);
                
                // Process the data directly from local memory
                this.parseData(results.data, true);
            }
        });
    }

    parseData(data, isNew) {
        if (!currentUser && data.length > 10) {
            data = data.slice(0, 10);
            this.showAlert("Guest mode: File truncated to first 10 transaction lines.", "info");
        }

        this.transactions = data.map(row => {
            const lineItem = this.calculateLineItem(row);
            return {
                ...row,
                lineItem: lineItem,
                category: this.categoriesDict[lineItem] || "",
                selected: false
            };
        });

        document.getElementById('syncQboBtn').disabled = false;
        
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="transactions"]').classList.add('active');
        this.renderTable();
    }

    async logFileRecord(file) {
        // We only write to Firestore to log the filename and date. Storage upload is completely bypassed.
        try {
            await setDoc(doc(db, "transactionFiles", file.name), {
                dateTimeUploaded: new Date().toISOString(),
                uploadedBy: currentUser ? currentUser.email : "Guest",
                storageStatus: "Bypassed"
            });
        } catch (e) {
            console.error("Firestore logging warning:", e);
        }
    }

    async updateCategory(lineItem, newCategory) {
        if(!newCategory || newCategory.trim() === "") return;
        try {
            await setDoc(doc(db, "category", lineItem), {
                lineItem: lineItem,
                category: newCategory
            });
            this.categoriesDict[lineItem] = newCategory;
            this.transactions.forEach(t => {
                if(t.lineItem === lineItem) t.category = newCategory;
            });
            this.renderTable(); 
        } catch (e) {
            alert("Error updating category database.");
        }
    }

    renderTable() {
        let html = `
            <div style="margin-bottom: 10px;">
                <button class="btn danger" onclick="window.deleteSelected()">Delete Selected</button>
            </div>
            <div class="table-responsive">
            <table><thead><tr>
                <th style="width: 40px;"><input type="checkbox" id="selectAllCb" onchange="window.toggleSelectAll(this.checked)"></th>
                <th>Line Item</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Order ID</th>
                <th>SKU</th>
                <th>Quantity Purchased</th>
                <th>Adjustment ID</th>
                <th>Shipment ID</th>
                <th>Fulfillment ID</th>
                <th>Marketplace Name</th>
                <th>Order Item ID</th>
                <th>Merchant Order Item ID</th>
                <th>Merchant Adjustment Item ID</th>
                <th>Promotion ID</th>
            </tr></thead><tbody>
        `;

        this.transactions.forEach((t, index) => {
            let catDisplay = t.category;
            if (!t.category) {
                catDisplay = `<input type="text" class="cat-input" placeholder="Add Category..." onblur="window.updateCat('${t.lineItem}', this.value)"><span class="text-danger"> Missing</span>`;
            }

            html += `<tr>
                <td><input type="checkbox" class="row-checkbox" ${t.selected ? 'checked' : ''} onchange="window.toggleRow(${index}, this.checked)"></td>
                <td><strong>${t.lineItem}</strong></td>
                <td>${catDisplay}</td>
                <td>${t.amount || 0}</td>
                <td>${t['posted-date'] || ''}</td>
                <td>${t['order-id'] || ''}</td>
                <td>${t['sku'] || ''}</td>
                <td>${t['quantity-purchased'] || ''}</td>
                <td>${t['adjustment-id'] || ''}</td>
                <td>${t['shipment-id'] || ''}</td>
                <td>${t['fulfillment-id'] || ''}</td>
                <td>${t['marketplace-name'] || ''}</td>
                <td>${t['order-item-code'] || ''}</td>
                <td>${t['merchant-order-item-id'] || ''}</td>
                <td>${t['merchant-adjustment-item-id'] || ''}</td>
                <td>${t['promotion-id'] || ''}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;

        // Expose global functions for inline HTML event listeners
        window.updateCat = (line, val) => this.updateCategory(line, val);
        
        window.toggleSelectAll = (checked) => {
            this.transactions.forEach(t => t.selected = checked);
            document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = checked);
        };
        
        window.toggleRow = (index, checked) => {
            this.transactions[index].selected = checked;
            const allChecked = this.transactions.length > 0 && this.transactions.every(t => t.selected);
            const selectAllCb = document.getElementById('selectAllCb');
            if (selectAllCb) selectAllCb.checked = allChecked;
        };

        window.deleteSelected = () => {
            this.transactions = this.transactions.filter(t => !t.selected);
            this.renderTable();
        };
    }

    renderJournal() {
        let summary = {};
        let netDeposit = 0;
        let missingCats = false;

        this.transactions.forEach(t => {
            const cat = t.category;
            if (!cat) missingCats = true;
            
            const amt = parseFloat(t.amount || 0);
            const key = cat || "UNCATEGORIZED";
            if (!summary[key]) summary[key] = 0;
            summary[key] += amt;
            netDeposit += amt;
        });

        if (missingCats) {
            this.showAlert("Warning: Some line items are missing categories. Please map them in the Transactions tab before syncing.", "warning");
        } else {
            this.hideAlert();
        }

        let html = `
            <div class="table-responsive">
            <table><thead><tr>
                <th>Account</th>
                <th>Debit</th>
                <th>Credit</th>
            </tr></thead><tbody>
        `;

        const depName = this.depositAccount && this.depositAccount.trim() !== "" ? this.depositAccount : "Checking";
        let journalLines = [];

        // 1. Process Deposit Account
        if (netDeposit > 0) {
            journalLines.push({ account: `<strong>${depName}</strong>`, debit: netDeposit, credit: 0, isDeposit: true });
        } else if (netDeposit < 0) {
            journalLines.push({ account: `<strong>${depName}</strong>`, debit: 0, credit: Math.abs(netDeposit), isDeposit: true });
        }

        let totalDebit = netDeposit > 0 ? netDeposit : 0;
        let totalCredit = netDeposit < 0 ? Math.abs(netDeposit) : 0;

        // 2. Process Categories
        Object.keys(summary).forEach(cat => {
            const amt = summary[cat];
            if (amt < 0) {
                journalLines.push({ account: cat, debit: Math.abs(amt), credit: 0, isDeposit: false });
                totalDebit += Math.abs(amt);
            } else if (amt > 0) {
                journalLines.push({ account: cat, debit: 0, credit: amt, isDeposit: false });
                totalCredit += amt;
            }
        });

        // 3. Sort Journal Lines
        journalLines.sort((a, b) => {
            // Deposit debit stays at absolute top
            if (a.isDeposit && a.debit > 0) return -1;
            if (b.isDeposit && b.debit > 0) return 1;
            
            // Deposit credit stays at absolute bottom
            if (a.isDeposit && a.credit > 0) return 1;
            if (b.isDeposit && b.credit > 0) return -1;

            // Debits must be placed above Credits
            if (a.debit > 0 && b.credit > 0) return -1;
            if (a.credit > 0 && b.debit > 0) return 1;

            return 0; // Maintain natural grouping otherwise
        });

        // 4. Render Sorted Rows
        journalLines.forEach(line => {
            const debitStr = line.debit > 0 ? line.debit.toFixed(2) : "";
            const creditStr = line.credit > 0 ? line.credit.toFixed(2) : "";
            const bgClass = line.isDeposit ? ' style="background:#e8f8f5;"' : '';
            
            html += `<tr${bgClass}><td>${line.account}</td><td>${debitStr}</td><td>${creditStr}</td></tr>`;
        });

        html += `<tr style="font-weight:bold; background:#e9ecef">
            <td>TOTAL</td>
            <td>${totalDebit.toFixed(2)}</td>
            <td>${totalCredit.toFixed(2)}</td>
        </tr>`;

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;
    }
}
