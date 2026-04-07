import { auth, provider } from './firebase-init.js';
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

const appRoot = document.getElementById('app-root');
const authBtn = document.getElementById('authBtn');
export let currentUser = null;

const routes = {
    '/': () => import('./views/Home.js').then(m => m.default),
    '/admin': () => import('./views/Admin.js').then(m => m.default)
};

async function router() {
    const path = window.location.pathname;
    const loadView = routes[path] || routes['/'];
    
    try {
        appRoot.innerHTML = '<div class="loader">Loading...</div>';
        const ViewComponent = await loadView();
        const viewInstance = new ViewComponent();
        appRoot.innerHTML = await viewInstance.render();
        await viewInstance.afterRender();
    } catch (error) {
        console.error("Routing Error:", error);
        appRoot.innerHTML = `<h2>Error loading module</h2>`;
    }
}

// Client-Side Routing Interceptor
window.addEventListener('popstate', router);
document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('click', e => {
        if (e.target.matches('[data-link]')) {
            e.preventDefault();
            window.history.pushState(null, null, e.target.href);
            router();
        }
    });

    // Auth Initialization
    onAuthStateChanged(auth, user => {
        currentUser = user;
        authBtn.innerText = user ? "Logout" : "Admin Login";
        router(); // Re-render view based on auth state
    });

    authBtn.addEventListener('click', () => {
        if (currentUser) signOut(auth);
        else signInWithPopup(auth, provider);
    });
});
