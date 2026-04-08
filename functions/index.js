const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

// Connect to the encrypted vault we just set up
const qboClientId = defineSecret("QBO_CLIENT_ID");
const qboClientSecret = defineSecret("QBO_CLIENT_SECRET");

exports.exchangeQboToken = onCall(
    { secrets: [qboClientId, qboClientSecret] },
    async (request) => {
        // 1. Security Check: Ensure the user clicking connect is actually logged into Excel Transaction Importer
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "You must be logged in to connect QuickBooks.");
        }

        const authCode = request.data.authCode;
        const realmId = request.data.realmId;
        const redirectUri = request.data.redirectUri;

        if (!authCode || !realmId) {
            throw new HttpsError("invalid-argument", "Missing Intuit authorization code.");
        }

        // 2. Prepare the highly secure "Basic Auth" header required by Intuit
        const authString = `${qboClientId.value()}:${qboClientSecret.value()}`;
        const authHeader = Buffer.from(authString).toString("base64");

        try {
            // 3. The Server-to-Server Handshake (This never touches the user's browser)
            // Note: We are using the Sandbox URL (sandbox-quickbooks.api.intuit.com). 
            // When you move to production, this URL changes to oauth.platform.intuit.com
            const response = await axios({
                method: "post",
                url: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": `Basic ${authHeader}`,
                },
                data: new URLSearchParams({
                    grant_type: "authorization_code",
                    code: authCode,
                    redirect_uri: redirectUri,
                }).toString(),
            });

            const tokens = response.data;

            // 4. Save the tokens securely in Firestore under the CPA's specific user profile
            const db = admin.firestore();
            await db.collection("users").doc(request.auth.uid).collection("qbo_connections").doc(realmId).set({
                companyName: `Connected QBO (${realmId})`,
                realmId: realmId,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                tokenExpiresAt: Date.now() + (tokens.expires_in * 1000),
                connectedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return { success: true, realmId: realmId };

        } catch (error) {
            console.error("Intuit API Error:", error.response ? error.response.data : error.message);
            throw new HttpsError("internal", "Failed to securely exchange tokens with Intuit.");
        }
    }
);
