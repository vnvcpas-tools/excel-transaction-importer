import { auth, provider, db, functions } from './auth.js';
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";

const appRoot = document.getElementById('app-root');
const authBtn = document.getElementById('authBtn');
export let currentUser = null;
export let activeQboConnections = [];

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

async function fetchQboConnections() {
    if (!currentUser) {
        activeQboConnections = [];
        renderQboHeader();
        return;
    }

    try {
        const snap = await getDocs(collection(db, "users", currentUser.uid, "qbo_connections"));
        activeQboConnections = [];
        snap.forEach(doc => {
            activeQboConnections.push({ id: doc.id, ...doc.data() });
        });
        renderQboHeader();
    } catch (error) {
        console.error("Error fetching QBO connections:", error);
        activeQboConnections = [];
        renderQboHeader();
    }
}

function renderQboHeader() {
    const container = document.getElementById('qbo-container');
    if (!container) return;

    if (!currentUser) {
        container.innerHTML = '';
        return;
    }

    if (activeQboConnections.length === 0) {
        container.innerHTML = `<button id="connectQboBtn" class="btn qbo-btn">Connect to QuickBooks</button>`;
        document.getElementById('connectQboBtn').addEventListener('click', initiateQboAuth);
    } else {
        let optionsHtml = '';
        activeQboConnections.forEach(conn => {
            optionsHtml += `<option value="${conn.realmId}">${conn.companyName}</option>`;
        });

        container.innerHTML = `
            <select id="qboSelect" class="qbo-select">
                ${optionsHtml}
            </select>
            <button id="connectNewQboBtn" class="btn qbo-btn outline-qbo">+ Add QBO</button>
        `;
        document.getElementById('connectNewQboBtn').addEventListener('click', initiateQboAuth);
        
        document.getElementById('qboSelect').addEventListener('change', (e) => {
            console.log("Switched active QBO company to Realm ID:", e.target.value);
        });
    }
}

function initiateQboAuth() {
    // Note: You must replace 'YOUR_PUBLIC_CLIENT_ID' with the Client ID from Intuit
    const intuitAuthUrl = "https://appcenter.intuit.com/connect/oauth2";
    const clientId = "YOUR_PUBLIC_CLIENT_ID"; 
    const redirectUri = window.location.origin + window.location.pathname; 
    const scope = "com.intuit.quickbooks.accounting";
    const state = "security_token_" + Math.random().toString(36).substring(7);

    // Send the user to the Intuit login screen
    window.location.href = `${intuitAuthUrl}?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
}

async function handleOauthCallback() {
    // When Intuit redirects back to Excel Transaction Importer, it puts the code in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const realmId = urlParams.get('realmId');

    if (authCode && realmId) {
        document.getElementById('app-root').innerHTML = `<div class="container" style="text-align:center;"><h2>Connecting to QuickBooks...</h2><p>Please wait, establishing secure server-to-server connection.</p></div>`;
        
        try {
            // Ask our secure Firebase Backend to do the Client Secret handshake
            const exchangeQboToken = httpsCallable(functions, 'exchangeQboToken');
            const redirectUri = window.location.origin + window.location.pathname;
            
            await exchangeQboToken({ 
                authCode: authCode, 
                realmId: realmId,
                redirectUri: redirectUri
            });

            // Wipe the temporary code from the URL bar so it looks clean again
            window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
            
            alert("Successfully connected to QuickBooks!");
            await fetchQboConnections();
            router(); 
        } catch (error) {
            console.error("OAuth Exchange Error:", error);
            alert("Failed to connect to QBO. See browser console for details.");
            router();
        }
    } else {
        router();
    }
}

window.addEventListener('hashchange', router);

document.addEventListener('DOMContentLoaded', () => {
    // Check if we just got redirected back from Intuit before routing normally
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('code')) {
        handleOauthCallback();
    } else {
        router();
    }

    onAuthStateChanged(auth, user => {
        currentUser = user;
        authBtn.innerText = user ? "Logout" : "Admin Login";
        if (user) {
            fetchQboConnections(); 
        } else {
            activeQboConnections = [];
            renderQboHeader();
        }
    });

    authBtn.addEventListener('click', () => {
        if (currentUser) signOut(auth);
        else signInWithPopup(auth, provider);
    });
});
