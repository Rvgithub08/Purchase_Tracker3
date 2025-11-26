import React, { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "./supabaseClient";
import { useAuth } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import { addPending, getPending, clearPending } from "./utils/offlineSync";
import {
  fetchPartiesRows,
  fetchPartyAnaajRowsForPartyIds,
  createPartyRow,
  renamePartyRow,
  deletePartyRow,
  addPartyAnaajRow,
  removePartyAnaajRow,
} from "./services/partiesService";

const getTodayLocalISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};
const toLocalISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};
const parseISOAsLocal = (iso) => {
  const [y, m, da] = (iso || "").split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, da || 1);
};

export default function App() {
  const { user, signOut } = useAuth();

  const [purchases, setPurchases] = useState([]);
  const [parties, setParties] = useState([]); // array of party NAMES (UI shape preserved)
  const [partyAnaajMap, setPartyAnaajMap] = useState({}); // { partyName: [anaajIds] }

  const [language, setLanguage] = useState("en");
  const [showModal, setShowModal] = useState(false);
  const [showPartyModal, setShowPartyModal] = useState(false);
  const [showManageAnaaj, setShowManageAnaaj] = useState(false);
  const [partyName, setPartyName] = useState("");

  const [editIndex, setEditIndex] = useState(null);
  const [recentlyDeleted, setRecentlyDeleted] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const [todayISO, setTodayISO] = useState(getTodayLocalISO());
  const [selectedDate, setSelectedDate] = useState(getTodayLocalISO());
  const [selectedParty, setSelectedParty] = useState(null); // stores PARTY NAME (UI shape preserved)
  const [selectedAnaaj, setSelectedAnaaj] = useState(null);
  const [selectedBillingType, setSelectedBillingType] = useState(null);

  const [form, setForm] = useState({
    id: null,
    date: getTodayLocalISO(),
    anaaj: "",
    shop: "",
    price: "",
    bags: "",
    billingType: "",
    bharti: "",
    bagType: "",
    note: "",
    party: "",
  });
  const [shopAutofilled, setShopAutofilled] = useState(false);

  const priceRef = useRef(null);
  const bagsRef = useRef(null);
  const shopRef = useRef(null);

  const anaajOptions = [
    { id: "moth", label: "मोठ / Moth" },
    { id: "moong", label: "मूंग / Moong" },
    { id: "wheat", label: "गेहूं / Wheat" },
    { id: "chana", label: "चना / Chana" },
    { id: "urad", label: "उड़द / Urad" },
    { id: "masoor", label: "मसूर / Masoor" },
    { id: "til", label: "तिल / Til" },
    { id: "sarso", label: "सरसों / Mustard" },
    { id: "bajra", label: "बाजरा / Bajra" },
    { id: "jowar", label: "ज्वार / Jowar" },
    { id: "moongfali", label: "मूंगफली / Peanut" },
    { id: "soyabean", label: "सोयाबीन / Soyabean" },
    { id: "narma", label: "नरमा / Narma" },
  ];

  const billingOptions =
    language === "hi" ? ["बिल", "टुक्का"] : ["Bill", "Tukka"];
  const bhartiOptions = ["30", "35", "40", "50", "60", "70"];
  const bagTypeOptions =
    language === "hi" ? ["प्लास्टिक", "जूूट"] : ["Plastic", "Jute"];

  // load persisted parties from DB when user available
  useEffect(() => {
    if (!user?.id) {
      setParties([]);
      setPartyAnaajMap({});
      return;
    }

    let active = true;
    (async () => {
      try {
        const partyRows = await fetchPartiesRows(user.id); // [{id,name}]
        if (!active) return;

        const partyNames = partyRows.map((r) => r.name || "").filter(Boolean);
        setParties(partyNames);
        try {
          localStorage.setItem(
            "purchase_tracker_parties",
            JSON.stringify(partyNames)
          );
        } catch (e) {}

        const partyIds = partyRows.map((r) => r.id);
        if (partyIds.length === 0) {
          setPartyAnaajMap({});
          return;
        }
        const anaajRows = await fetchPartyAnaajRowsForPartyIds(partyIds); // [{party_id, anaaj_id}]
        if (!active) return;

        const idToName = partyRows.reduce((acc, r) => {
          acc[r.id] = r.name;
          return acc;
        }, {});
        const map = {};
        (anaajRows || []).forEach((row) => {
          const pname = idToName[row.party_id];
          if (!pname) return;
          map[pname] = map[pname] || [];
          if (!map[pname].includes(row.anaaj_id)) map[pname].push(row.anaaj_id);
        });

        setPartyAnaajMap(map);
        try {
          localStorage.setItem(
            "purchase_tracker_party_anaaj",
            JSON.stringify(map)
          );
        } catch (e) {}
      } catch (err) {
        console.error("load parties failed", err);
        // fallback to localStorage
        try {
          const rawParties = JSON.parse(
            localStorage.getItem("purchase_tracker_parties") || "[]"
          );
          setParties(Array.isArray(rawParties) ? rawParties : []);
          const rawMap = JSON.parse(
            localStorage.getItem("purchase_tracker_party_anaaj") || "{}"
          );
          setPartyAnaajMap(typeof rawMap === "object" ? rawMap : {});
        } catch (e) {}
      }
    })();

    return () => {
      active = false;
    };
  }, [user?.id]);

  // fetch purchases for logged in user & setup realtime subscription
  useEffect(() => {
    if (!user?.id) {
      setPurchases([]);
      return;
    }

    let cancelled = false;
    const fetchPurchases = async () => {
      try {
        const { data, error } = await supabase
          .from("purchases")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at_ts", { ascending: false });

        if (error) throw error;
        const normalized = (data || []).map((r) => ({
          ...r,
          date: r.date
            ? typeof r.date === "string"
              ? r.date
              : r.date.toISOString().slice(0, 10)
            : r.date,
          // FIX Supabase timestamp format
          created_at: r.created_at
            ? new Date(r.created_at).toLocaleString()
            : "",
        }));
        if (!cancelled) setPurchases(normalized);
      } catch (e) {
        console.error("fetchPurchases error", e);
      }
    };

    fetchPurchases();

    const channel = supabase
      .channel(`public:purchases:user=${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "purchases",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const ev = payload.eventType;
          if (ev === "INSERT") {
            setPurchases((prev) => [
              payload.new,
              ...(Array.isArray(prev) ? prev : []),
            ]);
          } else if (ev === "UPDATE") {
            setPurchases((prev) =>
              Array.isArray(prev)
                ? prev.map((r) => (r.id === payload.new.id ? payload.new : r))
                : [payload.new]
            );
          } else if (ev === "DELETE") {
            setPurchases((prev) =>
              Array.isArray(prev)
                ? prev.filter((r) => r.id !== payload.old.id)
                : []
            );
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      try {
        supabase.removeChannel(channel);
      } catch (e) {}
    };
  }, [user?.id]);

  // offline flush on reconnect
  useEffect(() => {
    window.addEventListener("online", flushPending);
    flushPending();
    return () => window.removeEventListener("online", flushPending);
  }, [user?.id]);

  const flushPending = async () => {
    if (!user?.id) return;
    const pending = getPending();
    if (!Array.isArray(pending) || pending.length === 0) return;
    try {
      for (const item of pending) {
        if (item.__delete) {
          await supabase.from("purchases").delete().eq("id", item.id);
        } else {
          await supabase.from("purchases").upsert([item], { onConflict: "id" });
        }
      }
      clearPending();
    } catch (e) {
      console.error("flushPending error", e);
    }
  };

  const visiblePurchases = (Array.isArray(purchases) ? purchases : []).filter(
    (p) =>
      p &&
      p.date === selectedDate &&
      (!selectedParty || p.party === selectedParty) &&
      (!selectedAnaaj || p.anaaj === selectedAnaaj) &&
      (!selectedBillingType || p.billing_type === selectedBillingType)
  );

  const totalBags =
    visiblePurchases.length === 0
      ? 0
      : visiblePurchases.reduce((sum, p) => sum + Number(p.bags || 0), 0);

  const computeAvgPrice = () => {
    if (!Array.isArray(visiblePurchases) || visiblePurchases.length === 0)
      return "0.00";
    if (!selectedBillingType) {
      const totalWeightKg = visiblePurchases.reduce(
        (sum, p) =>
          sum +
          Number(p.bags || 0) *
            Number(
              p.bharti === "" || p.bharti === null || p.bharti === undefined
                ? 1
                : p.bharti
            ),
        0
      );
      if (totalWeightKg <= 0) return "0.00";
      const total = visiblePurchases.reduce(
        (sum, p) =>
          sum +
          Number(p.price || 0) *
            (Number(p.bags || 0) *
              Number(
                p.bharti === "" || p.bharti === null || p.bharti === undefined
                  ? 1
                  : p.bharti
              )),
        0
      );
      return (total / totalWeightKg).toFixed(2);
    }
    let totalAmount = 0;
    let totalWeightQuintal = 0;
    visiblePurchases.forEach((p) => {
      const price = Number(p.price || 0);
      const bags = Number(p.bags || 0);
      const weight = Number(
        p.bharti === "" || p.bharti === null || p.bharti === undefined
          ? 1
          : p.bharti
      );
      const amount = (price * bags * weight) / 100;
      let finalAmount = amount;
      const billLabel = language === "hi" ? "बिल" : "Bill";
      const tukkaLabel = language === "hi" ? "टुक्का" : "Tukka";
      if (selectedBillingType === billLabel)
        finalAmount = amount + (amount * 4.438) / 100 + bags * 2;
      else if (selectedBillingType === tukkaLabel)
        finalAmount = amount + (amount * 2.5) / 100 + bags * 2;
      totalAmount += finalAmount;
      totalWeightQuintal += (bags * weight) / 100;
    });
    if (totalWeightQuintal <= 0) return "0.00";
    return (totalAmount / totalWeightQuintal).toFixed(2);
  };

  const avgPrice = computeAvgPrice();
  const currentPartyAnaaj =
    selectedParty && partyAnaajMap[selectedParty]
      ? partyAnaajMap[selectedParty]
      : [];
  const filteredAnaajOptions = anaajOptions.filter((a) =>
    currentPartyAnaaj.includes(a.id)
  );
  const shopSuggestions = [
    ...new Set(
      (purchases || []).map((p) => (p.shop || "").trim()).filter(Boolean)
    ),
  ];

  const formToDb = (f) => ({
    id: f.id,
    user_id: user?.id,
    date: f.date,
    party: f.party || selectedParty || null,
    anaaj: f.anaaj || selectedAnaaj || null,
    shop: f.shop || "",
    price: f.price ? Number(f.price) : null,
    bags: f.bags ? Number(f.bags) : null,
    billing_type: f.billingType || "",
    bharti: f.bharti ? Number(f.bharti) : null,
    bag_type: f.bagType || "",
    note: f.note || "",
    created_at: new Date().toLocaleString(),
    created_at_ts: Date.now(),
  });

  const dbToForm = (row) => ({
    id: row.id,
    date: row.date,
    party: row.party,
    anaaj: row.anaaj,
    shop: row.shop,
    price: row.price,
    bags: row.bags,
    billingType: row.billing_type,
    bharti: row.bharti,
    bagType: row.bag_type,
    note: row.note,
  });

  // toggle party -> anaaj mapping (persist to DB)
  const togglePartyAnaaj = async (anaajId) => {
    if (!selectedParty) return;
    const partyName = selectedParty;

    try {
      // find or create party row in DB
      const { data: partyRow, error: pErr } = await supabase
        .from("parties")
        .select("id,name")
        .match({ user_id: user?.id, name: partyName })
        .limit(1)
        .maybeSingle();
      if (pErr) throw pErr;

      let partyId = partyRow?.id;
      if (!partyId) {
        const created = await createPartyRow(user.id, partyName);
        partyId = created?.id;
      }

      const existing = (partyAnaajMap && partyAnaajMap[partyName]) || [];
      const currentlyHas = existing.includes(anaajId);

      if (currentlyHas) {
        await removePartyAnaajRow(partyId, anaajId);
        setPartyAnaajMap((prev) => {
          const copy = { ...(prev || {}) };
          copy[partyName] = (copy[partyName] || []).filter(
            (id) => id !== anaajId
          );
          return copy;
        });
      } else {
        await addPartyAnaajRow(partyId, anaajId);
        setPartyAnaajMap((prev) => {
          const copy = { ...(prev || {}) };
          copy[partyName] = Array.isArray(copy[partyName])
            ? [...copy[partyName], anaajId]
            : [anaajId];
          return copy;
        });
      }
    } catch (err) {
      console.error("togglePartyAnaaj failed", err);
      alert("Failed to update anaaj mapping");
    }
  };

  const addOrUpdatePurchase = async () => {
    if (
      !form.date ||
      !String(form.shop).trim() ||
      String(form.price).trim() === "" ||
      String(form.bags).trim() === "" ||
      Number(form.price) <= 0 ||
      Number(form.bags) <= 0 ||
      !selectedParty ||
      !selectedAnaaj
    ) {
      alert(
        language === "hi"
          ? "कृपया आवश्यक फ़ील्ड भरें (दुकान, भाव, बोरी)"
          : "Please fill required fields (Shop, Price, Bags)"
      );
      return;
    }

    setPartyAnaajMap((prev) => {
      const existing = prev[selectedParty] || [];
      if (!existing.includes(selectedAnaaj))
        return { ...prev, [selectedParty]: [...existing, selectedAnaaj] };
      return prev;
    });

    const cleanedForm = {
      ...form,
      date: todayISO,
      anaaj: selectedAnaaj,
      bags: Number(form.bags) || 1,
      billingType: form.billingType || "",
      bharti: form.bharti || "",
      bagType: form.bagType || "",
      note: form.note || "",
      party: selectedParty,
    };

    const isUpdate = !!cleanedForm.id;
    const idForRow =
      cleanedForm.id ||
      Date.now().toString() + Math.random().toString(36).slice(2);
    const dbRow = formToDb({ ...cleanedForm, id: idForRow });

    // optimistic local update
    if (isUpdate) {
      setPurchases((prev) =>
        Array.isArray(prev)
          ? prev.map((r) => (r.id === idForRow ? dbRow : r))
          : [dbRow]
      );
    } else {
      setPurchases((prev) => [dbRow, ...(Array.isArray(prev) ? prev : [])]);
    }

    try {
      if (!navigator.onLine) {
        addPending(dbRow);
      } else {
        if (isUpdate) {
          const { error } = await supabase
            .from("purchases")
            .update(dbRow)
            .eq("id", idForRow);
          if (error) {
            console.error(error);
            addPending(dbRow);
          }
        } else {
          const { error } = await supabase.from("purchases").insert([dbRow]);
          if (error) {
            console.error(error);
            addPending(dbRow);
          }
        }
      }
    } catch (e) {
      console.error("addOrUpdatePurchase error", e);
      addPending(dbRow);
    }

    setForm({
      id: null,
      date: todayISO,
      anaaj: "",
      shop: "",
      price: "",
      bags: "",
      billingType: "",
      bharti: "",
      bagType: "",
      note: "",
      party: "",
    });
    setShopAutofilled(false);
    setShowModal(false);
    setEditIndex(null);
  };

  const handleDelete = (itemId) => {
    setConfirmDeleteId(itemId);
    setShowDeleteConfirm(true);
  };

  const performDeleteConfirmed = async () => {
    if (!confirmDeleteId) return;
    const deletedItem =
      purchases.find((p) => p && p.id === confirmDeleteId) || null;
    setRecentlyDeleted(deletedItem);
    setPurchases((prev) =>
      Array.isArray(prev)
        ? prev.filter((p) => p && p.id !== confirmDeleteId)
        : []
    );
    setShowDeleteConfirm(false);
    setConfirmDeleteId(null);

    try {
      if (!navigator.onLine) {
        addPending({ ...deletedItem, __delete: true });
      } else {
        const { error } = await supabase
          .from("purchases")
          .delete()
          .eq("id", deletedItem.id);
        if (error) {
          console.error("delete error", error);
          addPending({ ...deletedItem, __delete: true });
        }
      }
    } catch (err) {
      console.error("performDeleteConfirmed", err);
      addPending({ ...deletedItem, __delete: true });
    }

    setTimeout(() => setRecentlyDeleted(null), 5000);
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setConfirmDeleteId(null);
  };

  const undoDelete = () => {
    if (recentlyDeleted) {
      setPurchases((prev) => [
        recentlyDeleted,
        ...(Array.isArray(prev) ? prev : []),
      ]);
      addPending(recentlyDeleted);
      setRecentlyDeleted(null);
    }
  };

  const changeSelectedDateBy = (days) => {
    const d = parseISOAsLocal(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(toLocalISO(d));
  };

  const formatDateDisplay = (isoDate) => {
    try {
      const d = parseISOAsLocal(isoDate);
      return d.toLocaleDateString();
    } catch (e) {
      return isoDate;
    }
  };

  // createNewParty: persist to DB
  const createNewParty = async () => {
    const name = (partyName || "").trim();
    if (!name) return;
    if ((Array.isArray(parties) ? parties : []).includes(name)) {
      alert("Party already exists");
      return;
    }

    try {
      if (user?.id) {
        const created = await createPartyRow(user.id, name);
        setParties((prev) => [
          created.name,
          ...(Array.isArray(prev) ? prev : []),
        ]);
      } else {
        setParties((prev) => [name, ...(Array.isArray(prev) ? prev : [])]);
        localStorage.setItem(
          "purchase_tracker_parties",
          JSON.stringify([name, ...(Array.isArray(parties) ? parties : [])])
        );
      }
      setPartyName("");
      setShowPartyModal(false);
    } catch (err) {
      console.error("createNewParty failed", err);
      alert("Failed to create party");
    }
  };

  const openAddModalForDate = (date) => {
    if (date !== todayISO) {
      alert(
        language === "hi"
          ? "आप केवल आज के लिए नया जोड़ सकते हैं"
          : "You can only add new entries for today"
      );
      return;
    }
    if (!selectedParty) {
      alert(
        language === "hi"
          ? "कृपया पहले पार्टी चुनें"
          : "Please select a party first"
      );
      return;
    }
    if (!selectedAnaaj) {
      alert(
        language === "hi"
          ? "कृपया पहले अनाज चुनें"
          : "Please select anaaj first"
      );
      return;
    }

    const list = Array.isArray(purchases) ? purchases : [];
    const candidates = list.filter(
      (p) => p && p.party === selectedParty && p.anaaj === selectedAnaaj
    );
    const sorted = candidates
      .slice()
      .sort(
        (a, b) => Number(b?.created_at_ts || 0) - Number(a?.created_at_ts || 0)
      );
    const recent = sorted[0];

    setForm({
      id: null,
      date: todayISO,
      anaaj: selectedAnaaj,
      shop: recent ? recent.shop || "" : "",
      price: recent ? recent.price || "" : "",
      bags: "",
      billingType: recent ? recent.billing_type || "" : "",
      bharti: recent ? recent.bharti || "" : "",
      bagType: recent ? recent.bag_type || "" : "",
      note: recent ? recent.note || "" : "",
      party: selectedParty,
    });
    setEditIndex(null);
    setShopAutofilled(!!(recent && recent.shop));
    setShowModal(true);
  };

  const openEdit = (item) => {
    const idx = (Array.isArray(purchases) ? purchases : []).findIndex(
      (p) => p && p.id === item.id
    );
    if (idx === -1) return;
    setEditIndex(idx);
    setForm({
      ...(purchases[idx] ? dbToForm(purchases[idx]) : {}),
      party: purchases[idx].party,
    });
    setSelectedParty((purchases[idx] || {}).party || null);
    setSelectedAnaaj((purchases[idx] || {}).anaaj || null);
    setShopAutofilled(!!(purchases[idx] || {}).shop);
    setShowModal(true);
  };

  const handleExportPDF = () => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(14);
      doc.text("Purchase Tracker", 14, 16);
      doc.setFontSize(10);
      doc.text(
        `Party: ${selectedParty || "-"} | Anaaj: ${
          selectedAnaaj || "-"
        } | Date: ${selectedDate} | Type: ${selectedBillingType || "All"}`,
        14,
        24
      );
      const tableData = visiblePurchases.map((p) => [
        p.shop || "-",
        p.price || "-",
        p.bags || "-",
        p.bharti || "-",
        p.bag_type || "-",
        p.note || "-",
      ]);
      autoTable(doc, {
        head: [["Shop", "Price", "Bags", "Bharti", "Bag Type", "Note"]],
        body: tableData,
        startY: 30,
        styles: { fontSize: 10 },
        headStyles: { fillColor: [22, 78, 165] },
      });
      const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 40;
      doc.text(`Total Bags: ${totalBags}`, 14, finalY);
      doc.text(`Average Price: ${avgPrice}`, 14, finalY + 6);
      const fileName = `purchase-list-${selectedDate}.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error("Export PDF failed", err);
      alert("Export failed.");
    }
  };

  useEffect(() => {
    if (showModal && editIndex === null) {
      setTimeout(() => {
        if (priceRef.current) {
          priceRef.current.focus();
          try {
            priceRef.current.select();
          } catch (e) {}
        }
      }, 80);
    }
  }, [showModal, editIndex]);

  const handleShopFocus = (e) => {
    if (shopAutofilled) {
      try {
        e.target.select();
      } catch (err) {}
    }
  };

  return (
    <ProtectedRoute>
      <div className="p-6 max-w-5xl mx-auto bg-gradient-to-b from-gray-50 to-gray-100 min-h-screen rounded-lg relative">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-extrabold text-blue-700 drop-shadow-sm">
            {language === "hi" ? "खरीद ट्रैकर" : "Purchase Tracker"}
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLanguage(language === "en" ? "hi" : "en")}
              className="bg-white border px-4 py-2 rounded-full shadow hover:bg-blue-50 transition"
            >
              {language === "hi" ? "English" : "हिन्दी"}
            </button>
            <button
              onClick={() => {
                signOut();
                window.location.hash = "/login";
              }}
              className="bg-red-500 text-white px-4 py-2 rounded-full shadow hover:bg-red-600 transition"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-4 mb-6 border-t-4 border-blue-500">
          <div className="flex items-center gap-3 mb-3">
            <select
              value={selectedParty || ""}
              onChange={(e) => {
                setSelectedParty(e.target.value);
                setSelectedAnaaj(null);
              }}
              className="border px-3 py-2 rounded-lg"
            >
              <option value="">
                {language === "hi" ? "पार्टी चुनें" : "Select Party"}
              </option>
              {(Array.isArray(parties) ? parties : []).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowPartyModal(true)}
              className="bg-green-600 text-white px-4 py-2 rounded-lg"
            >
              {language === "hi" ? "नई पार्टी बनाएं" : "New Party"}
            </button>
            {selectedParty && (
              <button
                onClick={() => setShowManageAnaaj(true)}
                className="bg-white border px-3 py-2 rounded-lg shadow hover:bg-blue-50"
              >
                {language === "hi" ? "अनाज सेट करें" : "Manage Anaaj"}
              </button>
            )}
          </div>

          {selectedParty && (
            <div>
              <h2 className="font-bold mb-2">
                {language === "hi" ? "अनाज चुनें" : "Select Anaaj"}
              </h2>
              {filteredAnaajOptions.length === 0 ? (
                <div className="text-sm text-gray-500 mb-2">
                  {language === "hi"
                    ? "कोई अनाज चुना नहीं। ऊपर से अनाज जोड़ें।"
                    : "No anaaj selected yet. Use Manage Anaaj to add."}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 mb-2">
                {filteredAnaajOptions.map((a) => (
                  <button
                    key={a.id}
                    onClick={() =>
                      setSelectedAnaaj((prev) => (prev === a.id ? null : a.id))
                    }
                    className={`px-3 py-2 rounded-lg border ${
                      selectedAnaaj === a.id
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-center gap-4 mb-6">
          {billingOptions.map((b) => (
            <button
              key={b}
              onClick={() =>
                setSelectedBillingType((prev) => (prev === b ? null : b))
              }
              className={`px-6 py-2 rounded-lg border font-semibold transition ${
                selectedBillingType === b
                  ? "bg-blue-600 text-white"
                  : "bg-white hover:bg-blue-50"
              }`}
            >
              {b}
            </button>
          ))}
          <button
            type="button"
            onClick={handleExportPDF}
            className="px-2 py-2 rounded-lg border font-semibold transition bg-white hover:bg-blue-50"
          >
            Export PDF
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-2 py-2 rounded-lg border font-semibold transition bg-white hover:bg-blue-50"
          >
            Print
          </button>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-4 mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-t-4 border-blue-500">
          <div>
            <p className="text-gray-700 font-semibold">
              {language === "hi" ? "कुल बोरी" : "Total Bags"}:{" "}
              <span className="text-blue-600">{totalBags}</span>
            </p>
            <p className="text-gray-700 font-semibold">
              {language === "hi" ? "औसत मूल्य" : "Average Price"}:{" "}
              <span className="text-green-600">₹{avgPrice}</span>
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {language === "hi" ? "दिनांक" : "Date"}:{" "}
              <span className="font-medium">
                {formatDateDisplay(selectedDate)}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => changeSelectedDateBy(-1)}
                className="px-3 py-2 bg-gray-100 rounded-md"
              >
                ◀
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="border px-2 py-2 rounded-md w-full sm:w-[160px] text-sm"
              />
              <button
                onClick={() => changeSelectedDateBy(1)}
                className="px-3 py-2 bg-gray-100 rounded-md"
              >
                ▶
              </button>
            </div>
            <button
              onClick={() => openAddModalForDate(selectedDate)}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg shadow hover:bg-blue-700 transition"
            >
              {language === "hi" ? "नया जोड़ें" : "Add New"}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {visiblePurchases.length === 0 && (
            <div className="text-center text-gray-500 py-8 bg-white rounded-lg shadow">
              {language === "hi"
                ? "उस दिन कोई रिकॉर्ड नहीं मिला"
                : "No records for this date"}
            </div>
          )}
          {visiblePurchases.map((p) => (
            <motion.div
              key={p.id}
              layout
              className="bg-white shadow-md rounded-lg p-4 flex justify-between items-start border-l-4 border-blue-500"
            >
              <div>
                <p className="text-sm text-gray-500">🕒 {p.created_at}</p>
                <h3 className="text-lg font-bold text-blue-700">
                  {p.anaaj} — {p.shop} ({p.party})
                </h3>
                <p className="text-gray-700">
                  ₹{p.price} × {p.bags} {language === "hi" ? "बोरी" : "bags"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {p.billing_type} • {p.bharti} • {p.bag_type}
                </p>
                <p className="text-gray-600 text-sm mt-1">
                  {language === "hi" ? "टिप्पणी" : "Note"}: {p.note || "-"}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => openEdit(p)}
                  className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-white rounded-md"
                >
                  {language === "hi" ? "संपादित करें" : "Edit"}
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-md"
                >
                  {language === "hi" ? "हटाएं" : "Delete"}
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {recentlyDeleted && (
          <div className="fixed bottom-5 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4 backdrop-blur-md border border-gray-700">
            <span className="font-medium text-sm">
              {language === "hi" ? "आइटम हटाया गया" : "Item deleted"}
            </span>
            <button
              onClick={undoDelete}
              className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 py-1 rounded-full shadow"
            >
              {language === "hi" ? "पूर्ववत करें" : "Undo"}
            </button>
          </div>
        )}

        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50">
            <div className="bg-white p-6 rounded-xl shadow-lg max-w-md w-full">
              <h3 className="text-lg font-bold text-blue-700 mb-3">
                {language === "hi" ? "पुष्टि करें" : "Confirm"}
              </h3>
              <p className="text-gray-700 mb-4">
                {language === "hi"
                  ? "क्या आप वाकई इस आइटम को हटाना चाहते हैं?"
                  : "Are you sure you want to delete this item?"}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={cancelDelete}
                  className="bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded-lg"
                >
                  {language === "hi" ? "रद्द करें" : "Cancel"}
                </button>
                <button
                  onClick={performDeleteConfirmed}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg"
                >
                  {language === "hi" ? "हटा दें" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showModal && (
          <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white p-6 rounded-xl shadow-lg max-w-lg w-full my-10 max-h-[90vh] overflow-y-auto"
            >
              <h2 className="text-xl font-bold mb-4 text-blue-700 border-b pb-2">
                {editIndex !== null
                  ? language === "hi"
                    ? "संपादित करें"
                    : "Edit Purchase"
                  : language === "hi"
                  ? "खरीद जोड़ें"
                  : "Add Purchase"}
              </h2>

              <div className="grid gap-4">
                <div>
                  <label className="block text-gray-700 font-medium mb-1">
                    {language === "hi" ? "दुकान का नाम" : "Shop Name"}
                  </label>
                  <input
                    ref={shopRef}
                    list="shopNames"
                    value={form.shop}
                    onFocus={handleShopFocus}
                    onChange={(e) => {
                      setForm({ ...form, shop: e.target.value });
                      if (shopAutofilled) setShopAutofilled(false);
                    }}
                    className="border p-2 w-full rounded-lg focus:ring-2 focus:ring-blue-400"
                  />
                  <datalist id="shopNames">
                    {shopSuggestions.map((s, i) => (
                      <option key={i} value={s} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-gray-700 font-medium mb-1">
                    {language === "hi" ? "भाव" : "Price"}
                  </label>
                  <input
                    ref={priceRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={form.price}
                    onChange={(e) =>
                      setForm({ ...form, price: e.target.value })
                    }
                    className="border p-2 w-full rounded-lg focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 font-medium mb-1">
                    {language === "hi" ? "बोरी" : "Bags"}
                  </label>
                  <input
                    ref={bagsRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={form.bags}
                    onChange={(e) => setForm({ ...form, bags: e.target.value })}
                    className="border p-2 w-full rounded-lg focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 font-medium mb-1">
                    {language === "hi" ? "भर्ती" : "Bag Weight"}
                  </label>
                  <select
                    value={form.bharti}
                    onChange={(e) =>
                      setForm({ ...form, bharti: e.target.value })
                    }
                    className="border p-2 w-full rounded-lg focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">
                      {language === "hi" ? "कृपया चुनें" : "Please select"}
                    </option>
                    {bhartiOptions.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-700 font-medium mb-1">
                    {language === "hi" ? "बिलिंग प्रकार" : "Billing Type"}
                  </label>
                  <select
                    value={form.billingType}
                    onChange={(e) =>
                      setForm({ ...form, billingType: e.target.value })
                    }
                    className="border p-2 w-full rounded-lg focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">
                      {language === "hi" ? "कृपया चुनें" : "Please select"}
                    </option>
                    {billingOptions.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-700 font-medium mb-1">
                    {language === "hi" ? "बैग प्रकार" : "Bag Type"}
                  </label>
                  <select
                    value={form.bagType}
                    onChange={(e) =>
                      setForm({ ...form, bagType: e.target.value })
                    }
                    className="border p-2 w-full rounded-lg focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">
                      {language === "hi" ? "कृपया चुनें" : "Please select"}
                    </option>
                    {bagTypeOptions.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-700 font-medium mb-1">
                    {language === "hi" ? "टिप्पणी" : "Note"}
                  </label>
                  <textarea
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    className="border p-2 w-full rounded-lg focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                <div className="flex justify-end gap-3 mt-4 sticky bottom-0 bg-white pb-2 pt-2">
                  <button
                    onClick={() => {
                      setShowModal(false);
                      setEditIndex(null);
                    }}
                    className="bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded-lg transition"
                  >
                    {language === "hi" ? "रद्द करें" : "Cancel"}
                  </button>
                  <button
                    onClick={addOrUpdatePurchase}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
                  >
                    {editIndex !== null
                      ? language === "hi"
                        ? "अपडेट करें"
                        : "Update"
                      : language === "hi"
                      ? "जोड़ें"
                      : "Add"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showPartyModal && (
          <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white p-6 rounded-xl shadow-lg max-w-md w-full"
            >
              <h2 className="text-xl font-bold mb-4 text-blue-700 border-b pb-2">
                {language === "hi" ? "नई पार्टी बनाएं" : "Create New Party"}
              </h2>
              <input
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder={language === "hi" ? "पार्टी नाम" : "Party Name"}
                className="border p-2 w-full rounded-lg mb-4"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowPartyModal(false)}
                  className="bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded-lg"
                >
                  {language === "hi" ? "रद्द करें" : "Cancel"}
                </button>
                <button
                  onClick={createNewParty}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
                >
                  {language === "hi" ? "बनाएं" : "Create"}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showManageAnaaj && selectedParty && (
          <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white p-6 rounded-xl shadow-lg max-w-md w-full"
            >
              <h2 className="text-xl font-bold mb-4 text-blue-700 border-b pb-2">
                {language === "hi"
                  ? `${selectedParty} के लिए अनाज`
                  : `Anaaj for ${selectedParty}`}
              </h2>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {anaajOptions.map((a) => {
                  const checked = currentPartyAnaaj.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className={`flex items-center gap-2 border rounded-lg px-2 py-2 ${
                        checked ? "bg-blue-50 border-blue-300" : "bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePartyAnaaj(a.id)}
                      />
                      <span className="text-sm">{a.label}</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowManageAnaaj(false)}
                  className="bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded-lg"
                >
                  {language === "hi" ? "बंद करें" : "Close"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
