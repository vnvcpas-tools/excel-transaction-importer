OneBook: Excel Transaction Importer
A secure, cloud-based web application designed for CPA and bookkeeping workflows. This tool imports, parses, and categorizes Amazon Settlement Reports (CSV/TSV), transforming massive arrays of e-commerce transactions into clean, summarized Journal Entries ready to be pushed to QuickBooks Online (QBO).

Built specifically for VNV CPAs.

🚀 Features
Client-Side Parsing: Uses PapaParse to process massive CSV files in the browser without server lag.
Smart Categorization: Automatically generates a LineItem identifier using the formula [transaction-type] [amount-type] [amount-description] and matches it against a Firestore database of accounting categories.
Dynamic Journal Entries: Instantly summarizes thousands of rows into aggregated Debits and Credits based on the mapped categories.
Duplicate Detection: Scans Firebase Storage and Firestore to warn users if a settlement file has already been uploaded and processed.

Role-Based Access (RBAC):
  Guest Users: Limited to 10 transaction rows per upload and 10 uploads per month.
  Admin Users: Unlocked via Google Authentication for unlimited parsing and database management.

Admin Dashboard: Allows authorized users to preload and manage the master Category Mapping dictionary.

🏗️ Architecture & Tech Stack
This application is built as a Single Page Application (SPA) using vanilla web technologies and Google Firebase. It relies on no heavy frontend frameworks (like React or Vue), utilizing native browser capabilities for speed and simplicity.

Frontend: HTML5, CSS3, Vanilla JavaScript (ES6 Modules)
Design Patterns: Component-Based Architecture, Client-Side Routing, Dynamic Module Loading, Bootstrapping.
Backend (BaaS): * Firebase Hosting: Serves the frontend assets.
Firebase Auth: Manages Admin login via Google OAuth.
Firebase Firestore: NoSQL database storing the Category mappings and upload logs.
Firebase Cloud Storage: Secure digital filing cabinet for the raw Amazon CSV/TSV files.
Firebase Cloud Functions: (Planned) Secure backend environment for QBO API token exchange and payload processing.

📂 Folder Structure
Plaintext
excel-transaction-importer/
├── .github/                # GitHub Actions for CI/CD deployment
├── firebase.json           # Firebase CLI configuration
├── .firebaserc             # Firebase project targeting
├── public/                 # FRONTEND DIRECTORY
│   ├── index.html          # SPA Shell
│   ├── style.css           # Responsive styling
│   └── js/
│       ├── app.js               # Bootstrapper &amp; Router
│       ├── firebase-init.js     # Firebase SDK initialization
│       └── views/
│           ├── Home.js          # Importer &amp; Journal Entry UI
│           └── Admin.js         # Admin Preload UI
└── functions/              # BACKEND DIRECTORY
    ├── index.js            # Node.js backend logic (QBO integration)
    └── package.json        # Backend dependencies
⚙️ Installation & Setup
Clone the repository:
```bash
git clone https://github.com/vnvcpas-tools/excel-transaction-importer.git
cd excel-transaction-importer
```

Install the Firebase CLI:
```bash
npm install -g firebase-tools
```

Login to Firebase:
```bash
firebase login
```

Test Locally:
Start the local Firebase emulator to test the frontend and backend together.
```bash
firebase serve
```
Navigate to http://localhost:5000 in your browser.

Deploy to Production:
Deploy the application live to Firebase Hosting.
```bash
firebase deploy --only hosting
```

🔒 Security Notes
Client Data: Raw CSV files are directly uploaded to Firebase Cloud Storage. Ensure your storage.rules are configured to prevent unauthorized public reads.

API Keys: The Firebase configuration block in firebase-init.js contains public identifying keys. This is safe for Firebase, but QuickBooks Online API Secrets must never be placed in this folder. All QBO integration logic must occur in the /functions directory.

📄 License
Created for internal use by Joselito Villarta, CPA / VNV CPAs.
