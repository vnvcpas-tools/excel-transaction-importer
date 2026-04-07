import { db } from './firebase-config.js'; // Removed storage import
import { collection, doc, getDoc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
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

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                if(e.target.dataset.tab === 'transactions') this.renderTable();
                else this.renderJournal();
            });
        });
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
                category: this.categoriesDict[lineItem] || ""
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
            <div class="table-responsive">
            <table><thead><tr>
                <th>Line Item</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Order ID</th>
                <th>SKU</th>
            </tr></thead><tbody>
        `;

        this.transactions.forEach((t) => {
            let catDisplay = t.category;
            if (!t.category) {
                catDisplay = `<input type="text" class="cat-input" placeholder="Add Category..." onblur="window.updateCat('${t.lineItem}', this.value)"><span class="text-danger"> Missing</span>`;
            }

            html += `<tr>
                <td><strong>${t.lineItem}</strong></td>
                <td>${catDisplay}</td>
                <td>${t.amount || 0}</td>
                <td>${t['posted-date']}</td>
                <td>${t['order-id']}</td>
                <td>${t['sku']}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;

        window.updateCat = (line, val) => this.updateCategory(line, val);
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

        const depName = this.depositAccount || "[Bank/Deposit Account]";
        
        if (netDeposit > 0) {
            html += `<tr style="background:#e8f8f5;"><td><strong>${depName}</strong></td><td>${netDeposit.toFixed(2)}</td><td></td></tr>`;
        } else if (netDeposit < 0) {
            html += `<tr style="background:#e8f8f5;"><td><strong>${depName}</strong></td><td></td><td>${Math.abs(netDeposit).toFixed(2)}</td></tr>`;
        }

        let totalDebit = netDeposit > 0 ? netDeposit : 0;
        let totalCredit = netDeposit < 0 ? Math.abs(netDeposit) : 0;

        Object.keys(summary).forEach(cat => {
            const amt = summary[cat];
            let debit = "";
            let credit = "";

            if (amt < 0) {
                debit = Math.abs(amt).toFixed(2);
                totalDebit += Math.abs(amt);
            } else if (amt > 0) {
                credit = amt.toFixed(2);
                totalCredit += amt;
            }

            if (amt !== 0) {
                html += `<tr><td>${cat}</td><td>${debit}</td><td>${credit}</td></tr>`;
            }
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
