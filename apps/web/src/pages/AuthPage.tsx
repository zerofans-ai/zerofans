import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { apiRequest } from "../lib/api";
import { API_BASE_URL } from "../lib/config";
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
  const [searchParams] = useSearchParams();
  const { setSession } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) {
      setSession(token);
      navigate("/studio", { replace: true });
      return;
    }
    const err = searchParams.get("oauth_error");
    if (err) setOauthError(err);
  }, [searchParams, setSession, navigate]);

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

      <a
        href={`${API_BASE_URL}/api/auth/twitter`}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-3 font-semibold text-white transition hover:bg-gray-800"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        Sign in with X
      </a>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-tide/30" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-peach/95 px-4 text-slate-500">or</span>
        </div>
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

      {oauthError ? (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          X sign-in failed: {oauthError}
        </div>
      ) : null}
    </motion.section>
  );
}
