const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) throw new Error("Set JWT_SECRET in production");
const COOKIE = "cs_token";
const cookieOpts = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 3600e3 };
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10); // keeps login timing similar for unknown emails

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const sign = (res, u) => res.cookie(COOKIE, jwt.sign({ uid: u.id }, SECRET, { expiresIn: "7d" }), cookieOpts);

// Small in-memory limiter: max 10 failed logins per IP+email per 15 minutes
const fails = new Map();
const tooMany = (k) => { const f = fails.get(k); return f && f.n >= 10 && Date.now() - f.t < 15 * 60e3; };
const addFail = (k) => { const f = fails.get(k); fails.set(k, f && Date.now() - f.t < 15 * 60e3 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() }); };

function requireAuth(req, res, next) {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: "Please sign in" });
    try {
        const user = db.getUserById(jwt.verify(token, SECRET).uid);
        if (!user) throw new Error("no user");
        req.user = user;
        next();
    } catch {
        res.clearCookie(COOKIE);
        res.status(401).json({ error: "Session expired. Please sign in again." });
    }
}

function createAuth({ onUserCreated }) {
    const router = express.Router();

    async function register({ name, email, password }) {
        const id = db.createUser(name, email, await bcrypt.hash(password, 10));
        onUserCreated?.(id);
        return db.getUserById(id);
    }

    router.post("/signup", async (req, res) => {
        const name = String(req.body.name || "").trim(), email = String(req.body.email || "").trim().toLowerCase(), password = String(req.body.password || "");
        if (name.length < 2) return res.status(400).json({ error: "Please enter your full name" });
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
        if (password.length < 8 || !/\d/.test(password) || !/[A-Za-z]/.test(password)) return res.status(400).json({ error: "Password must be 8+ characters with letters and numbers" });
        try {
            const user = await register({ name, email, password });
            sign(res, user);
            res.status(201).json({ user: publicUser(user) });
        } catch (e) {
            if (String(e.code).startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "An account with this email already exists" });
            console.error(e);
            res.status(500).json({ error: "Could not create account" });
        }
    });

    router.post("/login", async (req, res) => {
        const email = String(req.body.email || "").trim().toLowerCase(), password = String(req.body.password || "");
        const key = req.ip + "|" + email;
        if (tooMany(key)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
        const user = db.getUserByEmail(email);
        const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
        if (!user || !ok) { addFail(key); return res.status(401).json({ error: "Incorrect email or password" }); }
        fails.delete(key);
        sign(res, user);
        res.json({ user: publicUser(user) });
    });

    router.post("/logout", (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });
    router.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

    // Creates a demo account the first time the server starts, so you can sign in straight away
    async function ensureDemoUser() {
        if (db.countUsers() === 0) await register({ name: "Dr. Aisha Mehta", email: "aisha@northbridge.edu", password: "Demo@1234" });
    }
    return { router, ensureDemoUser };
}

module.exports = { createAuth, requireAuth };