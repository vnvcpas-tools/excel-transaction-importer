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
            <style>
                @keyframes flashWarning {
                    0% { background-color: #fff3cd; }
                    50% { background-color: #ffe8a1; }
                    100% { background-color: #fff3cd; }
                }
            </style>
            
            <div class="container" style="padding-top: 0.25rem;">
                <h2 style="margin-top: 0; margin-bottom: 0.25rem; font-size: 1.4rem;">VilPorter to QBO (Amazon Date Range Report)</h2>
                <div id="alertBox" class="alert" style="margin-bottom: 0.25rem; padding: 0.4rem;"></div>

                <div id="pushStatusBar" style="background: #f8f9fa; border: 1px solid #dee2e6; border-left: 4px solid #3498db; padding: 0.4rem 1rem; margin-bottom: 0.25rem; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; position: relative; overflow: hidden;">
                    <div id="pushProgressFill" style="position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: #27ae60; z-index: 0; transition: width 0.3s ease;"></div>
                    <span id="pushStatusText" style="font-weight: 500; color: #2c3e50; z-index: 1; position: relative; transition: color 0.3s ease;">Status: Ready to import</span>
                    <span id="limitText" style="color: #666; z-index: 1; position: relative;"></span>
                </div>

                <div id="highVolumeBanner" style="display: none; animation: flashWarning 1.5s infinite; color: #856404; border: 1px solid #ffeeba; padding: 0.4rem; margin-bottom: 0.5rem; border-radius: 4px; text-align: center; font-size: 0.85rem; font-weight: bold;">
                    ⚠️ For a better experience, please reduce the number of transactions to push per batch to 500 or less by applying a date filter!
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
        
        this.updateReadyStatus();

        if (this.activeMainTab === 'unmapped') return this.renderUnmappedTable();
        if (this.activeSubTab === 'table') return this.renderTable();
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
