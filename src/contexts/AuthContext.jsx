import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const AuthContext = createContext();
const SESSION_KEY = "pt_user_session";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
  }, [user]);

  const signUp = async (username, password) => {
    try {
      // check existence
      const { data: exists } = await supabase
        .from("users")
        .select("id")
        .eq("username", username)
        .limit(1)
        .maybeSingle();
      if (exists) {
        return {
          error: new Error("Username already exists. Please sign in instead."),
        };
      }

      const id = Date.now().toString() + Math.random().toString(36).slice(2);
      const { error } = await supabase
        .from("users")
        .insert([{ id, username, password }]);
      if (error) return { error };
      const usr = { id, username };
      setUser(usr);
      return { user: usr };
    } catch (err) {
      return { error: err };
    }
  };

  const signIn = async (username, password) => {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, username, password")
        .eq("username", username)
        .limit(1)
        .maybeSingle();

      if (error) return { error };
      if (!data || data.password !== password)
        return { error: new Error("Invalid credentials") };

      const usr = { id: data.id, username: data.username };
      setUser(usr);
      return { user: usr };
    } catch (err) {
      return { error: err };
    }
  };

  const signOut = async () => {
    setUser(null);
    window.location.hash = "#/login";
  };

  return (
    <AuthContext.Provider value={{ user, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
