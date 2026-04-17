import { db } from './auth.js';
import { collection, doc, setDoc, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from './app.js';

export default class Admin {
    constructor() {
        this.categories = [];
        this.editingId = null;
        
        this.searchTerm = "";
        this.searchVisible = false;
    }

    async render() {
        if (!currentUser) {
            return `<div class="container"><h3>Access Denied. Please login via the navbar.</h3></div>`;
        }

        return `
            <div class="container">
                <h2>Admin Center</h2>
                <p>Logged in as: ${currentUser.email}</p>
                <hr>
                
                <h3>Manage Category Mappings</h3>
                <div class="control-panel" style="margin-bottom: 2rem; display: flex; flex-direction: column; gap: 10px;">
                    <h4 id="formTitle" style="margin: 0;">Add New Mapping</h4>
                    
                    <input type="text" id="catLineItem" placeholder="Line Item (Exact match from import file)" style="padding: 0.5rem;">
                    
                    <div style="display: flex; gap: 10px; width: 100%;">
                        <input type="text" id="catName" placeholder="QBO Category Name" style="padding: 0.5rem; flex: 1;">
                        <select id="catType" style="padding: 0.5rem; flex: 1;">
                            <option value="">Auto-Detect Type</option>
                            <option value="Income">Income</option>
                            <option value="Expense">Expense</option>
                            <option value="Bank">Bank / Clearing</option>
                            <option value="OtherCurrentAsset">Other Current Asset</option>
                            <option value="CostOfGoodsSold">Cost of Goods Sold</option>
                        </select>
                    </div>

                    <input type="text" id="catDesc" placeholder="Description / Notes (Optional)" style="padding: 0.5rem;">
                    
                    <div style="display: flex; gap: 10px;">
                        <button id="saveCatBtn" class="btn" style="padding: 0.5rem 1rem;">Save Mapping</button>
                        <button id="cancelEditBtn" class="btn outline" style="display: none; padding: 0.5rem 1rem;">Cancel Edit</button>
                    </div>
                    <div id="adminStatus" style="color: var(--accent); font-weight: bold; font-size: 0.9rem;"></div>
                </div>

                <div id="catTableContainer">
                    <p style="padding: 2rem; text-align: center; color: #7f8c8d;">Loading categories...</p>
                </div>
            </div>
        `;
    }

    async afterRender() {
        if (!currentUser) return;
        document.getElementById('saveCatBtn').addEventListener('click', () => this.handleSave());
        document.getElementById('cancelEditBtn').addEventListener('click', () => this.resetForm());
        await this.loadCategories();
    }

    async loadCategories() {
        try {
            const snap = await getDocs(collection(db, "category"));
            this.categories = [];
            snap.forEach(doc => {
                this.categories.push({ id: doc.id, ...doc.data() });
            });
            
            this.categories.sort((a, b) => a.lineItem.localeCompare(b.lineItem));
            this.renderTable();
        } catch (error) {
            console.error("Error loading categories:", error);
            document.getElementById('catTableContainer').innerHTML = `<p class="text-danger">Failed to load categories.</p>`;
        }
    }

    renderTable() {
        let html = `
            <div class="table-responsive">
            <table>
                <thead>
                    <tr>
                        <th style="padding: 0.5rem; width: 35%;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span style="white-space: nowrap;">Line Item</span>
                                <span id="searchToggleBtn" style="cursor: pointer; user-select: none;" title="Toggle Search">🔍</span>
                                <div id="searchContainer" style="display: ${this.searchVisible ? 'block' : 'none'}; flex: 1; min-width: 0;">
                                    <input type="text" id="searchInput" placeholder="Search..." value="${this.searchTerm}" style="padding: 0.5rem; width: 100%; box-sizing: border-box; font-weight: normal; font-size: 0.9rem; border: 1px solid #ccc; border-radius: 4px;">
                                </div>
                            </div>
                        </th>
                        <th style="padding: 0.5rem;">Category</th>
                        <th style="padding: 0.5rem;">Type</th>
                        <th style="padding: 0.5rem;">Description</th>
                        <th style="width: 130px; text-align: center; padding: 0.5rem;">Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (this.categories.length === 0) {
            html += `<tr><td colspan="5" style="text-align: center; padding: 0.5rem;">No categories found. Add one above.</td></tr>`;
        } else {
            this.categories.forEach((c, index) => {
                const isMatch = c.lineItem.toLowerCase().includes(this.searchTerm) || c.category.toLowerCase().includes(this.searchTerm);
                const displayStyle = isMatch ? '' : 'display: none;';

                html += `
                    <tr class="cat-row" data-index="${index}" style="cursor: pointer; transition: background 0.2s; ${displayStyle}" onmouseover="this.style.background='#f1f8ff'" onmouseout="this.style.background='transparent'">
                        <td style="padding: 0.5rem;"><strong class="line-item-text">${c.lineItem}</strong></td>
                        <td style="padding: 0.5rem;" class="cat-name-text">${c.category}</td>
                        <td style="padding: 0.5rem;">
                            <span style="background: #e9ecef; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">
                                ${c.accountType || 'Auto'}
                            </span>
                        </td>
                        <td style="padding: 0.5rem;">${c.description || '<span style="color:#aaa;">-</span>'}</td>
                        <td style="text-align: center; padding: 0.5rem; white-space: nowrap;">
                            <button class="btn outline edit-btn" data-index="${index}" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; margin-right: 5px;" title="Edit this row">Edit</button>
                            <button class="btn danger delete-btn" data-index="${index}" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" title="Delete this row">Delete</button>
                        </td>
                    </tr>
                `;
            });
        }

        html += `</tbody></table></div>`;
        document.getElementById('catTableContainer').innerHTML = html;
        this.attachTableListeners();
    }

    attachTableListeners() {
        const searchToggle = document.getElementById('searchToggleBtn');
        const searchContainer = document.getElementById('searchContainer');
        const searchInput = document.getElementById('searchInput');

        if (searchToggle && searchContainer && searchInput) {
            searchToggle.addEventListener('click', () => {
                this.searchVisible = !this.searchVisible;
                searchContainer.style.display = this.searchVisible ? 'block' : 'none';
                if (this.searchVisible) {
                    searchInput.focus();
                    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
                }
            });

            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.toLowerCase();
                document.querySelectorAll('.cat-row').forEach(row => {
                    const lineText = row.querySelector('.line-item-text').innerText.toLowerCase();
                    const catText = row.querySelector('.cat-name-text').innerText.toLowerCase();
                    row.style.display = (lineText.includes(this.searchTerm) || catText.includes(this.searchTerm)) ? '' : 'none';
                });
            });
        }

        document.querySelectorAll('.cat-row').forEach(row => {
            row.addEventListener('click', () => {
                this.startEdit(this.categories[row.dataset.index].id);
            });
        });

        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); 
                this.startEdit(this.categories[btn.dataset.index].id);
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); 
                this.handleDelete(this.categories[btn.dataset.index].id);
            });
        });
    }

    async handleSave() {
        const lineInput = document.getElementById('catLineItem');
        const catInput = document.getElementById('catName');
        const typeInput = document.getElementById('catType');
        const descInput = document.getElementById('catDesc');
        const statusDiv = document.getElementById('adminStatus');
        const saveBtn = document.getElementById('saveCatBtn');

        const lineVal = lineInput.value.trim();
        const catVal = catInput.value.trim();
        const typeVal = typeInput.value;
        const descVal = descInput.value.trim();

        if (!lineVal || !catVal) {
            statusDiv.innerText = "Error: Line Item and Category are required.";
            statusDiv.style.color = "red";
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";

        try {
            if (this.editingId && this.editingId !== lineVal) {
                await deleteDoc(doc(db, "category", this.editingId));
            }

            await setDoc(doc(db, "category", lineVal), {
                lineItem: lineVal,
                category: catVal,
                accountType: typeVal,
                description: descVal
            });

            statusDiv.innerText = "Successfully saved!";
            statusDiv.style.color = "green";
            this.resetForm();
            await this.loadCategories();
        } catch (error) {
            statusDiv.innerText = "Error saving to database.";
            statusDiv.style.color = "red";
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Mapping";
            setTimeout(() => statusDiv.innerText = "", 3000);
        }
    }

    startEdit(id) {
        const cat = this.categories.find(c => c.id === id);
        if (!cat) return;

        this.editingId = id;
        document.getElementById('formTitle').innerText = "Edit Mapping";
        document.getElementById('catLineItem').value = cat.lineItem;
        document.getElementById('catName').value = cat.category;
        document.getElementById('catType').value = cat.accountType || "";
        document.getElementById('catDesc').value = cat.description || "";
        
        document.getElementById('saveCatBtn').innerText = "Update Mapping";
        document.getElementById('cancelEditBtn').style.display = "inline-block";
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    resetForm() {
        this.editingId = null;
        document.getElementById('formTitle').innerText = "Add New Mapping";
        document.getElementById('catLineItem').value = "";
        document.getElementById('catName').value = "";
        document.getElementById('catType').value = "";
        document.getElementById('catDesc').value = "";
        
        document.getElementById('saveCatBtn').innerText = "Save Mapping";
        document.getElementById('cancelEditBtn').style.display = "none";
    }

    async handleDelete(id) {
        if (!confirm(`Are you sure you want to delete the mapping for:\n"${id}"?`)) return;

        try {
            await deleteDoc(doc(db, "category", id));
            await this.loadCategories();
            if (this.editingId === id) this.resetForm();
        } catch (error) {
            alert("Failed to delete category.");
        }
    }
}
