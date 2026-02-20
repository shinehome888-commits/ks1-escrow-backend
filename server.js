// server.js - The Brain of KS1 Escrow Pay (Updated with Fixed CORS)
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();

// --- 🔒 FIXED CORS CONFIGURATION ---
// This allows your Cloudflare Frontend to talk to this Render Backend
const allowedOrigins = [
  'https://ks1-escrow-pay.pages.dev',       // Your Cloudflare URL
  'https://ks1-escrow-pay.netlify.app',     // Fallback if you use Netlify
  'http://localhost:3000',                  // For local testing
  'http://localhost:5500',                  // Alternative local port
  'https://ks1-escrow-backend.onrender.com' // Self-reference
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl/postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('pages.dev')) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// --- 🗄️ DATABASE CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ks1_escrow';

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Connected to KS1 Database"))
  .catch(err => console.error("❌ DB Error:", err));

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
    console.error("Register Error:", err);
    res.status(400).json({ error: "Phone number already exists or invalid data." });
  }
});

// 2. Login User
app.post('/api/login', async (req, res) => {
  const { phone_number, password } = req.body;
  
  // Hardcoded Admin Check
  if(phone_number === "admin" && password === "admin123") {
    return res.json({ success: true, user: { id: 'admin', phone_number: 'Admin', isAdmin: true } });
  }
  
  const user = await User.findOne({ phone_number });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials." });
  }
  res.json({ success: true, user: { id: user._id, phone_number: user.phone_number } });
});

// 3. Create Transaction
app.post('/api/transactions', async (req, res) => {
  try {
    const { buyer_id, seller_phone, amount, description } = req.body;
    const fee = parseFloat((amount * 0.01).toFixed(2)); // 1% fee
    const txID = generateTxID();

    const transaction = await Transaction.create({
      transaction_id: txID, buyer_id, seller_phone, amount, fee, description
    });
    await Commission.create({ transaction_id: txID, amount: fee });
    
    res.json({ success: true, transaction });
  } catch (err) {
    res.status(500).json({ error: "Failed to create transaction." });
  }
});

// 4. Get User Transactions
app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const txs = await Transaction.find({ buyer_id: req.params.userId }).sort({ created_at: -1 });
    res.json(txs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch transactions." });
  }
});

// 5. Confirm Payment (User)
app.post('/api/payments/confirm', async (req, res) => {
  try {
    const { transaction_id, momo_reference } = req.body;
    await Payment.create({ transaction_id, momo_reference, verified: false });
    res.json({ success: true, message: "Payment submitted for verification." });
  } catch (err) {
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
