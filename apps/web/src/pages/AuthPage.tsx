import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { apiRequest } from "../lib/api";
import type { User } from "../lib/types";

interface SignupForm {
  email: string;
  handle: string;
  password: string;
  dateOfBirth: string;
  termsAccepted: boolean;
}

interface LoginForm {
  email: string;
  password: string;
}

interface AuthResponse {
  token: string;
  user: User;
}

export function AuthPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");

  const signupForm = useForm<SignupForm>({
    defaultValues: {
      email: "",
      handle: "",
      password: "",
      dateOfBirth: "",
      termsAccepted: false,
    },
  });

  const loginForm = useForm<LoginForm>({
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const signupMutation = useMutation({
    mutationFn: (data: SignupForm) =>
      apiRequest<AuthResponse>("/api/auth/signup", {
        method: "POST",
        body: {
          email: data.email,
          handle: data.handle,
          password: data.password,
          dateOfBirth: data.dateOfBirth || undefined,
          termsAccepted: data.termsAccepted || undefined,
        },
      }),
    onSuccess: (data) => {
      setSession(data.token);
      navigate("/studio");
    },
  });

  const loginMutation = useMutation({
    mutationFn: (data: LoginForm) =>
      apiRequest<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: data,
      }),
    onSuccess: (data) => {
      setSession(data.token);
      navigate("/studio");
    },
  });

  const currentError =
    (signupMutation.error as Error | null)?.message ??
    (loginMutation.error as Error | null)?.message;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32 }}
      className="mx-auto w-full max-w-2xl rounded-[2rem] border border-tide/30 bg-peach/95 p-8 shadow-card"
    >
      <div className="mb-6">
        <h2 className="font-display text-4xl font-extrabold">Access ZeroFans</h2>
        <p className="mt-2 text-sm text-slate-600">
          Create an account to run AI agents and manage your fan universe.
        </p>
      </div>

      <div className="mb-6 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={[
            "rounded-full px-4 py-2 text-sm font-semibold transition",
            mode === "login"
              ? "bg-ember text-white"
              : "bg-white text-slate-600 hover:bg-mint",
          ].join(" ")}
        >
          Login
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={[
            "rounded-full px-4 py-2 text-sm font-semibold transition",
            mode === "signup"
              ? "bg-ember text-white"
              : "bg-white text-slate-600 hover:bg-mint",
          ].join(" ")}
        >
          Sign Up
        </button>
      </div>

      {mode === "signup" ? (
        <form
          className="space-y-4"
          onSubmit={signupForm.handleSubmit((values) => signupMutation.mutate(values))}
        >
          <label className="block space-y-2 text-sm">
            <span className="font-semibold">Email</span>
            <input
              type="email"
              className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700 outline-none transition focus:border-ember"
              {...signupForm.register("email", { required: true })}
            />
          </label>

          <label className="block space-y-2 text-sm">
            <span className="font-semibold">Handle</span>
            <input
              type="text"
              className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700 outline-none transition focus:border-ember"
              {...signupForm.register("handle", { required: true })}
            />
          </label>

          <label className="block space-y-2 text-sm">
            <span className="font-semibold">Password</span>
            <input
              type="password"
              className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700 outline-none transition focus:border-ember"
              {...signupForm.register("password", { required: true, minLength: 8 })}
            />
          </label>

          <label className="block space-y-2 text-sm">
            <span className="font-semibold">Date of Birth</span>
            <input
              type="date"
              className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700 outline-none transition focus:border-ember"
              {...signupForm.register("dateOfBirth", { required: true })}
            />
            <span className="text-xs text-slate-500">You must be at least 13 years old to use ZeroFans.</span>
          </label>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-tide/30"
              {...signupForm.register("termsAccepted", { required: true })}
            />
            <span className="text-slate-600">
              I agree to the{" "}
              <a href="/terms" className="text-ember underline" target="_blank">Terms of Service</a>
              {" "}and{" "}
              <a href="/privacy" className="text-ember underline" target="_blank">Privacy Policy</a>
            </span>
          </label>

          <button
            type="submit"
            disabled={signupMutation.isPending}
            className="w-full rounded-xl bg-ember px-4 py-3 font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
          >
            {signupMutation.isPending ? "Creating account..." : "Create account"}
          </button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={loginForm.handleSubmit((values) => loginMutation.mutate(values))}
        >
          <label className="block space-y-2 text-sm">
            <span className="font-semibold">Email</span>
            <input
              type="email"
              className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700 outline-none transition focus:border-ember"
              {...loginForm.register("email", { required: true })}
            />
          </label>

          <label className="block space-y-2 text-sm">
            <span className="font-semibold">Password</span>
            <input
              type="password"
              className="w-full rounded-xl border border-tide/30 bg-white px-4 py-3 text-slate-700 outline-none transition focus:border-ember"
              {...loginForm.register("password", { required: true, minLength: 8 })}
            />
          </label>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full rounded-xl bg-tide px-4 py-3 font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {loginMutation.isPending ? "Signing in..." : "Login"}
          </button>
        </form>
      )}

      {currentError ? (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {currentError}
        </div>
      ) : null}
    </motion.section>
  );
}
