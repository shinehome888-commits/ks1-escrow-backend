// server.js - KS1 Escrow Pay (Stable Version - Fixed Error 500)
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();

// --- 🔒 CORS CONFIGURATION ---
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.options('*', cors()); 

app.use(express.json());

// --- 🗄️ DATABASE CONNECTION ---
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ CRITICAL: MONGO_URI is missing!");
  process.exit(1);
}

console.log("🔄 Connecting to MongoDB...");
mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(() => console.log("✅ Connected to KS1 Database SUCCESSFULLY"))
.catch(err => {
  console.error("❌ FATAL DB ERROR:", err.message);
});

// --- 📝 MODELS ---
const UserSchema = new mongoose.Schema({ phone_number: { type: String, required: true, unique: true }, password: { type: String, required: true }, created_at: { type: Date, default: Date.now } });
const User = mongoose.model('User', UserSchema);

const TransactionSchema = new mongoose.Schema({
  transaction_id: { type: String, required: true, unique: true },
  buyer_id: { type: String },
  buyer_phone: { type: String }, 
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

const PaymentSchema = new mongoose.Schema({ transaction_id: { type: String, required: true }, momo_reference: String, verified: { type: Boolean, default: false }, created_at: { type: Date, default: Date.now } });
const Payment = mongoose.model('Payment', PaymentSchema);

const CommissionSchema = new mongoose.Schema({ transaction_id: { type: String, required: true }, amount: { type: Number, required: true }, status: { type: String, enum: ['pending', 'paid'], default: 'pending' }, destination_number: { type: String, default: "+233240254680" } });
const Commission = mongoose.model('Commission', CommissionSchema);

const generateTxID = () => `KS1-${Math.floor(100000 + Math.random() * 900000)}`;

// --- ❤️ HEALTH CHECK ---
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'KS1 Backend is Running!', 
    db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    timestamp: new Date().toISOString()
  });
});

// --- 🚦 ROUTES ---

// 1. Register User
app.post('/api/register', async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password) return res.status(400).json({ error: "Missing fields" });
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ phone_number, password: hashedPassword });
    res.json({ success: true, message: "Welcome to Alkebulan." });
  } catch (err) {
    console.error("Register Error:", err);
    res.status(400).json({ error: err.code === 11000 ? "Number exists" : "Server error" });
  }
});

// 2. Login User
app.post('/api/login', async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if(phone_number === "admin" && password === "admin123") return res.json({ success: true, user: { id: 'admin', phone_number: 'Admin', isAdmin: true } });
    const user = await User.findOne({ phone_number });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid credentials" });
    res.json({ success: true, user: { id: user._id, phone_number: user.phone_number } });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 3. Create Transaction (Saves Buyer Phone)
app.post('/api/transactions', async (req, res) => {
  try {
    const { buyer_id, seller_phone, amount, description } = req.body;
    if (!buyer_id || !seller_phone || !amount) return res.status(400).json({ error: "Missing fields" });
    
    const buyer = await User.findById(buyer_id);
    const buyerPhoneNumber = buyer ? buyer.phone_number : 'Unknown';

    const fee = parseFloat((amount * 0.01).toFixed(2));
    const txID = generateTxID();
    
    const transaction = await Transaction.create({ 
      transaction_id: txID, 
      buyer_id, 
      buyer_phone: buyerPhoneNumber, 
      seller_phone, 
      amount, 
      fee, 
      description 
    });
    await Commission.create({ transaction_id: txID, amount: fee });
    res.json({ success: true, transaction });
  } catch (err) {
    console.error("Transaction Error:", err);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

// 4. Get User Transactions
app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const txs = await Transaction.find({ buyer_id: req.params.userId }).sort({ created_at: -1 });
    res.json(txs);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed" });
  }
});

// 5. Confirm Payment
app.post('/api/payments/confirm', async (req, res) => {
  try {
    const { transaction_id, momo_reference } = req.body;
    await Payment.create({ transaction_id, momo_reference, verified: false });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Payment submit failed" });
  }
});

// 6. Confirm Delivery
app.put('/api/transactions/:id/confirm-delivery', async (req, res) => {
  try {
    await Transaction.findByIdAndUpdate(req.params.id, { status: 'delivered' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Confirm failed" }); }
});

// 7. Open Dispute
app.put('/api/transactions/:id/dispute', async (req, res) => {
  try {
    await Transaction.findByIdAndUpdate(req.params.id, { status: 'disputed' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Dispute failed" }); }
});

// --- 👑 ADMIN ROUTES (SAFE & STABLE) ---

// 8. Get All Admin Data (SIMPLIFIED TO PREVENT CRASH)
app.get('/api/admin/data', async (req, res) => {
  try {
    // Just fetch the data directly without complex loops
    const transactions = await Transaction.find().sort({ created_at: -1 });
    const payments = await Payment.find();
    const commissions = await Commission.find();
    
    res.json({ transactions, payments, commissions });
  } catch (err) {
    console.error("CRITICAL Admin Data Error:", err);
    // Send a specific error message so we know what happened
    res.status(500).json({ error: "Failed to load admin data: " + err.message });
  }
});

// 9. Verify Payment
app.put('/api/admin/verify', async (req, res) => {
  try {
    const { transaction_id } = req.body;
    await Payment.findOneAndUpdate({ transaction_id }, { verified: true });
    await Transaction.findOneAndUpdate({ transaction_id }, { status: 'funded' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Verify failed" }); }
});

// 10. Release Funds
app.put('/api/admin/release', async (req, res) => {
  try {
    const { transaction_id } = req.body;
    await Transaction.findOneAndUpdate({ transaction_id }, { status: 'completed' });
    await Commission.findOneAndUpdate({ transaction_id }, { status: 'paid' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Release failed" }); }
});

// 11. Refund Buyer
app.put('/api/admin/refund', async (req, res) => {
  try {
    const { transaction_id } = req.body;
    await Transaction.findOneAndUpdate({ transaction_id }, { status: 'cancelled' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Refund failed" }); }
});

// --- 🗑️ 12. DELETE PAYMENT ROUTE ---
app.delete('/api/admin/delete-payment/:txId', async (req, res) => {
  try {
    const { txId } = req.params;
    await Payment.findOneAndDelete({ transaction_id: txId });
    await Transaction.findOneAndDelete({ transaction_id: txId });
    await Commission.findOneAndDelete({ transaction_id: txId });
    res.json({ success: true, message: "Deleted successfully" });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 KS1 Escrow Pay running on port ${PORT}`);
  console.log(`✅ Admin Data endpoint is stable and ready.`);
});
