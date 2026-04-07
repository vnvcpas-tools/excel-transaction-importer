import { db } from '../firebase-init.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from '../app.js';

export default class Admin {
    async render() {
        if (!currentUser) {
            return `<div class="container"><h3>Access Denied. Please login via the navbar.</h3></div>`;
        }

        return `
            <div class="container">
                <h2>Admin Center</h2>
                <p>Logged in as: ${currentUser.email}</p>
                <hr>
                <h3>Database Operations</h3>
                <p>Push the button below to initialize the exact preloaded LineItems and Categories provided in the specification.</p>
                <button id="preloadBtn" class="btn">Preload Category Database</button>
                <div id="adminStatus" style="margin-top: 1rem; color: var(--accent); font-weight: bold;"></div>
            </div>
        `;
    }

    async afterRender() {
        const btn = document.getElementById('preloadBtn');
        if (btn) {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.innerText = "Processing...";
                await this.preloadCategories();
                document.getElementById('adminStatus').innerText = "Preload Complete! Firestore Category collection updated.";
                btn.innerText = "Preload Category Database";
                btn.disabled = false;
            });
        }
    }

    async preloadCategories() {
        const rawData = [
            { line: "A-to-z Guarantee Refund ItemFees Commission", cat: "Amazon Fees" },
            { line: "A-to-z Guarantee Refund ItemFees RefundCommission", cat: "Amazon Fees" },
            { line: "A-to-z Guarantee Refund ItemPrice Principal", cat: "Refunds/Discounts Given" },
            { line: "A-to-z Guarantee Refund ItemPrice Tax", cat: "Sales Tax Payable" },
            { line: "A-to-z Guarantee Refund ItemWithheldTax MarketplaceFacilitatorTax-Principal", cat: "Sales Tax Payable" },
            { line: "other-transaction FBA Inbound Placement Service Fee", cat: "Amazon Fees" },
            { line: "Refund ItemPrice Goodwill", cat: "Refunds/Discounts Given" },
            { line: "other-transaction NonSubscriptionFeeAdj", cat: "Amazon Fees" },
            { line: "Refund ItemWithheldTax MarketplaceFacilitatorVAT-Principal", cat: "Sales Tax Payable" },
            { line: "other-transaction FBA Inventory Reimbursement WAREHOUSE_LOST", cat: "Refunds/Discounts Given" },
            { line: "Refund ItemPrice RestockingFee", cat: "Amazon Fees" },
            { line: "Order ItemFees Commission", cat: "Amazon Fees" },
            { line: "Order ItemFees FBAPerUnitFulfillmentFee", cat: "Amazon Fees" },
            { line: "Order ItemFees GiftwrapChargeback", cat: "Revenue - Shipping Charges" },
            { line: "Order ItemFees ShippingChargeback", cat: "Revenue - Shipping Charges" },
            { line: "Order ItemFees ShippingHB", cat: "Amazon Fees" },
            { line: "Order ItemPrice GiftWrap", cat: "Revenue - Shipping Charges" },
            { line: "Order ItemPrice GiftWrapTax", cat: "Sales Tax Payable" },
            { line: "Order ItemPrice Principal", cat: "Revenue - Sales" },
            { line: "Order ItemPrice Shipping", cat: "Revenue - Shipping Charges" },
            { line: "Order ItemPrice ShippingTax", cat: "Sales Tax Payable" },
            { line: "Order ItemPrice Tax", cat: "Sales Tax Payable" },
            { line: "Order ItemWithheldTax MarketplaceFacilitatorTax-Other", cat: "Sales Tax Payable" },
            { line: "Order ItemWithheldTax MarketplaceFacilitatorTax-Principal", cat: "Sales Tax Payable" },
            { line: "Order ItemWithheldTax MarketplaceFacilitatorTax-Shipping", cat: "Sales Tax Payable" },
            { line: "Order Promotion Shipping", cat: "Postage" },
            { line: "other-transaction Adjustment", cat: "Amazon Fees" },
            { line: "other-transaction Amazon Capital Services", cat: "Amazon Loan Payable" },
            { line: "other-transaction Current Reserve Amount", cat: "Amazon Payment" },
            { line: "other-transaction FBAInboundTransportationFee", cat: "Amazon Fees" },
            { line: "other-transaction MiscAdjustment", cat: "Amazon Fees" },
            { line: "other-transaction Previous Reserve Amount Balance", cat: "Amazon Payment" },
            { line: "other-transaction RemovalComplete", cat: "Amazon Fees" },
            { line: "other-transaction Shipping label purchase", cat: "Postage" },
            { line: "other-transaction Shipping label purchase for return", cat: "Postage" },
            { line: "other-transaction ShippingServicesRefund", cat: "Postage" },
            { line: "other-transaction Storage Fee", cat: "Amazon Fees" },
            { line: "other-transaction StorageRenewalBilling", cat: "Amazon Fees" },
            { line: "other-transaction Subscription Fee", cat: "Dues and Subscriptions" },
            { line: "other-transaction FBA Inventory Reimbursement COMPENSATED_CLAWBACK", cat: "Refunds/Discounts Given" },
            { line: "other-transaction FBA Inventory Reimbursement FREE_REPLACEMENT_REFUND_ITEMS", cat: "Refunds/Discounts Given" },
            { line: "other-transaction FBA Inventory Reimbursement REVERSAL_REIMBURSEMENT", cat: "Refunds/Discounts Given" },
            { line: "Refund ItemFees Commission", cat: "Amazon Fees" },
            { line: "Refund ItemFees RefundCommission", cat: "Amazon Fees" },
            { line: "Refund ItemFees ShippingChargeback", cat: "Revenue - Shipping Charges" },
            { line: "Refund ItemFees ShippingHB", cat: "Amazon Fees" },
            { line: "Refund ItemPrice Principal", cat: "Refunds/Discounts Given" },
            { line: "Refund ItemPrice ReturnShipping", cat: "Revenue - Shipping Charges" },
            { line: "Refund ItemPrice Shipping", cat: "Revenue - Shipping Charges" },
            { line: "Refund ItemPrice ShippingTax", cat: "Sales Tax Payable" },
            { line: "Refund ItemPrice Tax", cat: "Sales Tax Payable" },
            { line: "Refund ItemWithheldTax MarketplaceFacilitatorTax-Principal", cat: "Sales Tax Payable" },
            { line: "Refund ItemWithheldTax MarketplaceFacilitatorTax-Shipping", cat: "Sales Tax Payable" },
            { line: "Refund Promotion Shipping", cat: "Revenue - Shipping Charges" },
            { line: "ServiceFee Cost of Advertising TransactionTotalAmount", cat: "Advertising" }
        ];

        // Using standard loops to avoid Promise.all limits on free tier bursts
        for (let i = 0; i < rawData.length; i++) {
            const data = rawData[i];
            const cleanLine = data.line.replace(/\s+/g, ' ').trim();
            await setDoc(doc(db, "category", cleanLine), {
                lineItem: cleanLine,
                category: data.cat
            });
        }
    }
}
