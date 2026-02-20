// server.js - KS1 Escrow Pay Backend (Fixed CORS - Open for Testing)
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();

// --- 🔒 FIXED CORS CONFIGURATION (OPEN FOR TESTING) ---
// This allows ANY domain to talk to this backend temporarily for debugging
app.use(cors({
  origin: '*', // Allows all origins (Cloudflare, Netlify, Localhost, etc.)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));

// Handle preflight requests explicitly
app.options('*', cors());

app.use(express.json());

// --- 🗄️ DATABASE CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ks1_escrow';

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Connected to KS1 Database"))
  .catch(err => {
    console.error("❌ DB Connection Error:", err);
    process.exit(1);
  });

// --- 📝 DATABASE MODELS ---

const UserSchema = new mongoose.Schema({
  phone_number: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const TransactionSchema = new mongoose.Schema({
  transaction_id: { type: String, required: true, unique: true },
  buyer_id: { type: String }, 
  seller_phone: { type: String, required: true },
  amount: { type: Number, required: true },
  fee: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending_payment', 'funded', 'delivered', 'completed', 'disputed', 'cancelled'], 
    default: 'pending_payment' 
  },
  description: String,
  created_at: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', TransactionSchema);

const PaymentSchema = new mongoose.Schema({
  transaction_id: { type: String, required: true },
  momo_reference: String,
  verified: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});
const Payment = mongoose.model('Payment', PaymentSchema);

const CommissionSchema = new mongoose.Schema({
  transaction_id: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  destination_number: { type: String, default: "+233240254680" }
});
const Commission = mongoose.model('Commission', CommissionSchema);

// --- 🔧 HELPER FUNCTIONS ---
const generateTxID = () => `KS1-${Math.floor(100000 + Math.random() * 900000)}`;

// --- 🚦 API ROUTES ---

// 1. Register User
app.post('/api/register', async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password) {
      return res.status(400).json({ error: "Phone and password required." });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ phone_number, password: hashedPassword });
    res.json({ success: true, message: "Welcome to Alkebulan freedom." });
  } catch (err) {
    console.error("Register Error Details:", err);
    // Check specifically for duplicate key error
    if (err.code === 11000) {
      return res.status(400).json({ error: "Phone number already exists." });
    }
    res.status(500).json({ error: "Server error during registration." });
  }
});

// 2. Login User
app.post('/api/login', async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    
    // Hardcoded Admin Check
    if(phone_number === "admin" && password === "admin123") {
      return res.json({ success: true, user: { id: 'admin', phone_number: 'Admin', isAdmin: true } });
    }
    
    const user = await User.findOne({ phone_number });
    if (!user) {
      return res.status(401).json({ error: "User not found." });
    }
    if (!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid password." });
    }
    res.json({ success: true, user: { id: user._id, phone_number: user.phone_number } });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server error during login." });
  }
});

// 3. Create Transaction
app.post('/api/transactions', async (req, res) => {
  try {
    const { buyer_id, seller_phone, amount, description } = req.body;
    if (!buyer_id || !seller_phone || !amount) {
      return res.status(400).json({ error: "Missing required fields." });
    }
    const fee = parseFloat((amount * 0.01).toFixed(2)); // 1% fee
    const txID = generateTxID();

    const transaction = await Transaction.create({
      transaction_id: txID, buyer_id, seller_phone, amount, fee, description
    });
    await Commission.create({ transaction_id: txID, amount: fee });
    
    res.json({ success: true, transaction });
  } catch (err) {
    console.error("Create Tx Error:", err);
    res.status(500).json({ error: "Failed to create transaction." });
  }
});

// 4. Get User Transactions
app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const txs = await Transaction.find({ buyer_id: req.params.userId }).sort({ created_at: -1 });
    res.json(txs);
  } catch (err) {
    console.error("Get Tx Error:", err);
    res.status(500).json({ error: "Failed to fetch transactions." });
  }
});

// 5. Confirm Payment (User)
app.post('/api/payments/confirm', async (req, res) => {
  try {
    const { transaction_id, momo_reference } = req.body;
    if (!transaction_id || !momo_reference) {
      return res.status(400).json({ error: "Missing details." });
    }
    await Payment.create({ transaction_id, momo_reference, verified: false });
    res.json({ success: true, message: "Payment submitted for verification." });
  } catch (err) {
    console.error("Payment Confirm Error:", err);
    res.status(500).json({ error: "Failed to submit payment." });
  }
});

// 6. Confirm Delivery (Buyer)
app.put('/api/transactions/:id/confirm-delivery', async (req, res) => {
  try {
    await Transaction.findByIdAndUpdate(req.params.id, { status: 'delivered' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to confirm delivery." });
  }
});

// 7. Open Dispute
app.put('/api/transactions/:id/dispute', async (req, res) => {
  try {
    await Transaction.findByIdAndUpdate(req.params.id, { status: 'disputed' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to open dispute." });
  }
});

// --- 👑 ADMIN ROUTES ---

// 8. Get All Admin Data
app.get('/api/admin/data', async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ created_at: -1 });
    const payments = await Payment.find();
    const commissions = await Commission.find();
    res.json({ transactions, payments, commissions });
  } catch (err) {
    console.error("Admin Data Error:", err);
    res.status(500).json({ error: "Failed to load admin data." });
  }
});

// 9. Verify Payment
app.put('/api/admin/verify', async (req, res) => {
  try {
    const { transaction_id } = req.body;
    await Payment.findOneAndUpdate({ transaction_id }, { verified: true });
    await Transaction.findOneAndUpdate({ transaction_id }, { status: 'funded' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to verify payment." });
  }
});

// 10. Release Funds
app.put('/api/admin/release', async (req, res) => {
  try {
    const { transaction_id } = req.body;
    await Transaction.findOneAndUpdate({ transaction_id }, { status: 'completed' });
    await Commission.findOneAndUpdate({ transaction_id }, { status: 'paid' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to release funds." });
  }
});

// 11. Refund Buyer
app.put('/api/admin/refund', async (req, res) => {
  try {
    const { transaction_id } = req.body;
    await Transaction.findOneAndUpdate({ transaction_id }, { status: 'cancelled' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to refund." });
  }
});

// --- 🚀 START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 KS1 Escrow Pay running on port ${PORT}`));
