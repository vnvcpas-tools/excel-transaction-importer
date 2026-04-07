import { db, storage } from '../firebase-init.js';
import { collection, doc, getDoc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";
import { currentUser } from '../app.js';

export default class Home {
    constructor() {
        this.transactions = [];
        this.categoriesDict = {};
        this.depositAccount = "";
    }

    async render() {
        return `
            <div class="container">
                <h2>Import Amazon Transactions</h2>
                <div id="alertBox"></div>

                <div class="control-panel">
                    <input type="file" id="csvFile" accept=".csv, .tsv">
                    <input type="text" id="depositAccount" placeholder="Enter Deposit Account (e.g., Checking)">
                    <button id="syncQboBtn" class="btn" disabled>Push to QBO</button>
                    <span style="margin-left:auto; font-size: 0.9rem; color: #666;">
                        ${currentUser ? 'Unlimited Uploads Enabled' : 'Guest Limit: 10 Rows (Max 10 uploads/mo)'}
                    </span>
                </div>

                <div class="tabs">
                    <button class="tab active" data-tab="transactions">Individual Transactions</button>
                    <button class="tab" data-tab="journal">Summary Journal Entry</button>
                </div>

                <div id="tabContent"></div>
            </div>
        `;
    }

    async afterRender() {
        await this.loadCategories();
        
        document.getElementById('csvFile').addEventListener('change', e => this.handleFileSelect(e));
        document.getElementById('depositAccount').addEventListener('input', e => {
            this.depositAccount = e.target.value;
            if(document.querySelector('.tab.active').dataset.tab === 'journal') this.renderJournal();
        });

        // Tab Switching Logic
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
        document.getElementById('alertBox').innerHTML = `<div class="alert alert-${type}">${message}</div>`;
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
        let uploads = parseInt(localStorage.getItem('guestUploads') || "0");
        if (uploads >= 10) {
            this.showAlert("Monthly guest upload limit reached (10). Please ask an Admin to login.");
            return false;
        }
        localStorage.setItem('guestUploads', uploads + 1);
        return true;
    }

    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!this.checkGuestLimits()) return;

        const fileDocRef = doc(db, "transactionFiles", file.name);
        const fileDocSnap = await getDoc(fileDocRef);

        if (fileDocSnap.exists()) {
            const proceed = confirm("An existing file with the same filename exists. Click OK to pull the old file, or Cancel to rename your new file.");
            if (!proceed) {
                e.target.value = ""; // Reset input
                return;
            }

            try {
                const storageRef = ref(storage, `uploads/${file.name}`);
                const url = await getDownloadURL(storageRef);
                const response = await fetch(url);
                const text = await response.text();
                this.showAlert("Warning: These transactions might have already been posted to QuickBooks. Please check QuickBooks thoroughly.");
                this.parseData(text, file.name, false); 
            } catch (err) {
                this.showAlert("Warning: The old file might have been deleted from storage. Make sure this new file is not a duplicate of previously processed transactions.");
                this.parseFileAndUpload(file);
            }
        } else {
            this.parseFileAndUpload(file);
        }
    }

    parseFileAndUpload(file) {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                await this.uploadFileRecord(file);
                this.parseData(results.data, file.name, true);
            }
        });
    }

    parseData(data, filename, isNew) {
        if (typeof data === "string") {
            data = Papa.parse(data, { header: true, skipEmptyLines: true }).data;
        }

        if (!currentUser && data.length > 10) {
            data = data.slice(0, 10);
            this.showAlert("Guest mode: File truncated to first 10 rows.");
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
        this.renderTable();
    }

    async uploadFileRecord(file) {
        try {
            const storageRef = ref(storage, `uploads/${file.name}`);
            await uploadBytes(storageRef, file);
            await setDoc(doc(db, "transactionFiles", file.name), {
                dateTimeUploaded: new Date().toISOString(),
                uploadedBy: currentUser ? currentUser.email : "Guest"
            });
        } catch (e) {
            console.error("Storage upload failed, but processing continues.", e);
        }
    }

    async updateCategory(lineItem, newCategory) {
        if(!newCategory) return;
        try {
            await setDoc(doc(db, "category", lineItem), {
                lineItem: lineItem,
                category: newCategory
            });
            this.categoriesDict[lineItem] = newCategory;
            this.transactions.forEach(t => {
                if(t.lineItem === lineItem) t.category = newCategory;
            });
            this.renderTable(); // Re-render to clear warnings
        } catch (e) {
            alert("Error updating category.");
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
            </tr></thead><tbody>
        `;

        this.transactions.forEach((t, i) => {
            const hasCat = t.category !== "";
            const catDisplay = hasCat 
                ? t.category 
                : `<input type="text" placeholder="Add Category" onblur="window.updateCat('${t.lineItem}', this.value)"><span class="text-danger"> Missing</span>`;

            html += `<tr>
                <td>${t.lineItem}</td>
                <td>${catDisplay}</td>
                <td>${t.amount}</td>
                <td>${t['posted-date']}</td>
                <td>${t['order-id']}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;

        // Expose update function to global scope for inline HTML onblur event
        window.updateCat = (line, val) => this.updateCategory(line, val);
    }

    renderJournal() {
        let summary = {};
        let netDeposit = 0;

        this.transactions.forEach(t => {
            const cat = t.category || "Uncategorized Error";
            const amt = parseFloat(t.amount || 0);
            if (!summary[cat]) summary[cat] = 0;
            summary[cat] += amt;
            netDeposit += amt;
        });

        let html = `
            <div class="table-responsive">
            <table><thead><tr>
                <th>Account</th>
                <th>Debit</th>
                <th>Credit</th>
            </tr></thead><tbody>
        `;

        // 1. Render balancing Deposit Account row first
        const depName = this.depositAccount || "[Deposit Account Required]";
        if (netDeposit > 0) {
            html += `<tr style="background:#f1f8e9;"><td><strong>${depName}</strong></td><td>${netDeposit.toFixed(2)}</td><td></td></tr>`;
        } else if (netDeposit < 0) {
            html += `<tr style="background:#f1f8e9;"><td><strong>${depName}</strong></td><td></td><td>${Math.abs(netDeposit).toFixed(2)}</td></tr>`;
        }

        // 2. Render all categorized rows based on requirements
        // Negative net amount -> displayed as positive under Debit
        // Positive net amount -> displayed as positive under Credit
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
