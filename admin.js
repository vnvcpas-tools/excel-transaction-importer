import { db } from './auth.js';
import { collection, doc, setDoc, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from './app.js';

export default class Admin {
    constructor() {
        this.categories = [];
        this.editingId = null;
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
                    <h4 id="formTitle">Add New Mapping</h4>
                    <input type="text" id="catLineItem" placeholder="Line Item (Exact match from import file)">
                    <input type="text" id="catName" placeholder="QBO Category Name">
                    <input type="text" id="catDesc" placeholder="Description / Notes (Optional)">
                    <div style="display: flex; gap: 10px;">
                        <button id="saveCatBtn" class="btn">Save Mapping</button>
                        <button id="cancelEditBtn" class="btn outline" style="display: none;">Cancel Edit</button>
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
            
            // Sort alphabetically by lineItem so it's easy to read
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
                        <th>Line Item</th>
                        <th>Category</th>
                        <th>Description</th>
                        <th style="width: 150px; text-align: center;">Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (this.categories.length === 0) {
            html += `<tr><td colspan="4" style="text-align: center;">No categories found. Add one above.</td></tr>`;
        } else {
            // Use the array index to perfectly link the row to the data, avoiding string escape bugs
            this.categories.forEach((c, index) => {
                html += `
                    <tr class="cat-row" data-index="${index}" style="cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#f1f8ff'" onmouseout="this.style.background='transparent'">
                        <td><strong>${c.lineItem}</strong></td>
                        <td>${c.category}</td>
                        <td>${c.description || '<span style="color:#aaa;">No description</span>'}</td>
                        <td style="text-align: center;">
                            <button class="btn outline edit-btn" data-index="${index}" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; margin-right: 5px;" title="Edit this row">Edit</button>
                            <button class="btn danger delete-btn" data-index="${index}" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" title="Delete this row">Delete</button>
                        </td>
                    </tr>
                `;
            });
        }

        html += `</tbody></table></div>`;
        document.getElementById('catTableContainer').innerHTML = html;

        // Attach strict event listeners after rendering the HTML
        this.attachTableListeners();
    }

    attachTableListeners() {
        // 1. Click Row to Edit
        document.querySelectorAll('.cat-row').forEach(row => {
            row.addEventListener('click', () => {
                const cat = this.categories[row.dataset.index];
                this.startEdit(cat.id);
            });
        });

        // 2. Click Edit Button (Prevents triggering the row click twice)
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); 
                const cat = this.categories[btn.dataset.index];
                this.startEdit(cat.id);
            });
        });

        // 3. Click Delete Button (Prevents triggering row edit)
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); 
                const cat = this.categories[btn.dataset.index];
                this.handleDelete(cat.id);
            });
        });
    }

    async handleSave() {
        const lineInput = document.getElementById('catLineItem');
        const catInput = document.getElementById('catName');
        const descInput = document.getElementById('catDesc');
        const statusDiv = document.getElementById('adminStatus');
        const saveBtn = document.getElementById('saveCatBtn');

        const lineVal = lineInput.value.trim();
        const catVal = catInput.value.trim();
        const descVal = descInput.value.trim();

        if (!lineVal || !catVal) {
            statusDiv.innerText = "Error: Line Item and Category are required.";
            statusDiv.style.color = "red";
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";

        try {
            // If editing and the Line Item (which is the Doc ID) changed, delete the old document first
            if (this.editingId && this.editingId !== lineVal) {
                await deleteDoc(doc(db, "category", this.editingId));
            }

            // Create or overwrite the document
            await setDoc(doc(db, "category", lineVal), {
                lineItem: lineVal,
                category: catVal,
                description: descVal
            });

            statusDiv.innerText = "Successfully saved!";
            statusDiv.style.color = "green";
            this.resetForm();
            await this.loadCategories();
        } catch (error) {
            console.error("Save error:", error);
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
        document.getElementById('catDesc').value = cat.description || "";
        
        document.getElementById('saveCatBtn').innerText = "Update Mapping";
        document.getElementById('cancelEditBtn').style.display = "inline-block";
        
        // Scroll to the top to see the form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    resetForm() {
        this.editingId = null;
        document.getElementById('formTitle').innerText = "Add New Mapping";
        document.getElementById('catLineItem').value = "";
        document.getElementById('catName').value = "";
        document.getElementById('catDesc').value = "";
        
        document.getElementById('saveCatBtn').innerText = "Save Mapping";
        document.getElementById('cancelEditBtn').style.display = "none";
    }

    async handleDelete(id) {
        if (!confirm(`Are you sure you want to delete the mapping for:\n"${id}"?`)) return;

        try {
            await deleteDoc(doc(db, "category", id));
            await this.loadCategories();
            
            // If they happen to delete the item they are currently editing, clear the form
            if (this.editingId === id) this.resetForm();
        } catch (error) {
            console.error("Delete error:", error);
            alert("Failed to delete category. See console for details.");
        }
    }
}
