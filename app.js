import { auth, provider } from './auth.js';
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

const appRoot = document.getElementById('app-root');
const authBtn = document.getElementById('authBtn');
export let currentUser = null;

// Hash-Based Router avoids 404s on GitHub Pages
const routes = {
    '#/': () => import('./home.js').then(m => m.default),
    '#/admin': () => import('./admin.js').then(m => m.default)
};

async function router() {
    let hash = window.location.hash || '#/';
    const loadView = routes[hash] || routes['#/'];
    
    try {
        const ViewComponent = await loadView();
        const viewInstance = new ViewComponent();
        appRoot.innerHTML = await viewInstance.render();
        await viewInstance.afterRender();
    } catch (error) {
        console.error("Routing Error:", error);
        appRoot.innerHTML = `<div class="container"><h2>Module Load Error</h2></div>`;
    }
}

// Listen for hash changes
window.addEventListener('hashchange', router);

document.addEventListener('DOMContentLoaded', () => {
    // Initial route check
    router();

    onAuthStateChanged(auth, user => {
        currentUser = user;
        authBtn.innerText = user ? "Logout" : "Admin Login";
        router(); // Refresh view when auth changes
    });

    authBtn.addEventListener('click', () => {
        if (currentUser) signOut(auth);
        else signInWithPopup(auth, provider);
    });
});
