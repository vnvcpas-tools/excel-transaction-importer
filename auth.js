import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyC_reVQpx1F0QnynRCPFj0T1btKAoZLkK4",
    authDomain: "excel-transaction-importer.firebaseapp.com",
    projectId: "excel-transaction-importer",
    storageBucket: "excel-transaction-importer.firebasestorage.app",
    messagingSenderId: "1080856597867",
    appId: "1:1080856597867:web:767356c09bb243d44ca82e",
    measurementId: "G-6PZ1KPJDGX"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const functions = getFunctions(app);
