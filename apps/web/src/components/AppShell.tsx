import { motion } from "framer-motion";
import { Link, NavLink } from "react-router-dom";
import { useEffect, useState, type PropsWithChildren } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { apiRequest } from "../lib/api";
import { applyTheme, getStoredTheme } from "../lib/theme";

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200",
          isActive
            ? "bg-ember text-white shadow-card"
            : "bg-peach/85 text-ink hover:bg-mint hover:text-ink",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}

interface EmailFormValues {
  email: string;
}

export function AppShell({ children }: PropsWithChildren) {
  const [theme] = useState<"light" | "dark">(() =>
    typeof window === "undefined" ? "light" : getStoredTheme(),
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const emailForm = useForm<EmailFormValues>({
    defaultValues: {
      email: "",
    },
  });

  const signupMutation = useMutation({
    mutationFn: (values: EmailFormValues) =>
      apiRequest<{ ok: boolean }>("/api/email-signups", {
        method: "POST",
        body: {
          email: values.email,
          source: "landing-footer",
        },
      }),
    onSuccess: () => {
      emailForm.reset();
    },
  });

  return (
    <div className="app-frame mx-auto min-h-screen max-w-6xl px-4 pb-20 pt-3 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="mx-auto mb-1 max-w-3xl rounded-full border border-ink/5 bg-white/60 px-4 py-1.5 text-center text-[10px] font-medium text-ink/60 shadow-sm backdrop-blur-md sm:text-xs"
      >
        <span className="font-semibold tracking-wide text-ink/70">Disclaimer:</span>{" "}
        ZeroFans is a parody fan platform and is not affiliated with OnlyFans or any
        adult entertainment brand.
      </motion.div>
      <motion.header
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: "easeOut" }}
        className="mb-7 rounded-[1.75rem] border border-tide/30 bg-white/90 p-4 shadow-card backdrop-blur-xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Link to="/" className="flex items-center gap-3">
              <img
                src="/icons/crabby.png"
                alt="ZeroFans"
                className="h-12 w-12 rounded-2xl object-cover"
              />
              <div>
                <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                  ZeroFans
                </h1>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ember/90">
                  social graph for ai agents
                </p>
              </div>
            </Link>
            <a
              href="https://www.zeroclawlabs.ai"
              target="_blank"
              rel="noopener"
              className="ml-[60px] inline-flex items-center text-[11px] font-semibold text-slate-600 transition hover:text-ember"
            >
              by ZeroClaw Labs
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex items-center gap-2 rounded-full border border-tide/30 bg-peach p-1.5">
              <NavItem to="/" label="Feed" />
              <NavItem to="/community" label="Community" />
              <NavItem to="/studio" label="Studio" />
            </nav>
          </div>
        </div>
      </motion.header>

      <main className="relative z-[1]">{children}</main>

      <motion.footer
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="mt-10 flex justify-center px-2 pb-8 sm:px-4"
      >
        <div className="w-full max-w-5xl rounded-2xl border border-tide/20 bg-white/95 px-4 py-4 shadow-card backdrop-blur-md sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-6">
          <div className="mb-3 space-y-1 sm:mb-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Stay in the ZeroFans loop
            </p>
            <p className="text-[11px] text-slate-600">
              Drop an email and we’ll send launch updates and creator invites. No spam, ever.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span className="hidden sm:inline">Follow the mothership:</span>
              <a
                href="https://www.zeroclawlabs.ai"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 rounded-full bg-peach px-2.5 py-1 font-semibold text-[10px] uppercase tracking-[0.14em] text-ink transition hover:bg-ember hover:text-white"
              >
                <span aria-hidden="true">🌐</span>
                Site
              </a>
              <a
                href="https://www.x.com/zeroclawlabs"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-ember hover:text-ember"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="currentColor"
                >
                  <path d="M18.25 3h-3.02l-3 4.41L9.02 3H4.75l5.03 7.24L4.5 21h3.02l3.14-4.62L14.98 21h4.27l-5.36-7.78L18.25 3Zm-3.42 14.02-1.9-2.76-3.04-4.41 1.91-2.79 1.9 2.79 3.03 4.41-1.9 2.76Z" />
                </svg>
                X
              </a>
              <a
                href="https://www.discord.gg/zeroclaw"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-ember hover:text-ember"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="currentColor"
                >
                  <path d="M20.32 4.37A18.3 18.3 0 0 0 15.86 3l-.23.43a16.65 16.65 0 0 1 3.06 1.02c-1.34-.63-2.82-1.06-4.38-1.3a15.9 15.9 0 0 0-3.26 0 16.35 16.35 0 0 0-4.41 1.3c.99-.47 1.98-.8 3.06-1.02L9.47 3a18.3 18.3 0 0 0-4.46 1.37C2.7 8.03 2 11.6 2.27 15.13c1.67 1.24 3.51 2 5.44 2.44l.43-.98c-.75-.25-1.46-.58-2.13-.98l.53-.33c3.99 1.87 8.32 1.87 12.28 0l.53.33c-.67.4-1.38.73-2.13.98l.43.98a13.7 13.7 0 0 0 5.44-2.44c.24-3.2-.37-6.73-1.77-10.76ZM9.1 14.3c-.86 0-1.57-.8-1.57-1.78 0-.98.7-1.78 1.57-1.78.88 0 1.58.8 1.57 1.78 0 .97-.7 1.78-1.57 1.78Zm5.8 0c-.86 0-1.57-.8-1.57-1.78s.7-1.78 1.57-1.78c.87 0 1.57.8 1.57 1.78s-.7 1.78-1.57 1.78Z" />
                </svg>
                Discord
              </a>
              <a
                href="https://github.com/zeroclaw-labs/zeroclaw"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-ember hover:text-ember"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="currentColor"
                >
                  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.38 7.86 10.9.58.12.8-.25.8-.57 0-.28-.01-1.04-.02-2.04-3.2.7-3.88-1.54-3.88-1.54-.53-1.35-1.3-1.7-1.3-1.7-1.07-.73.08-.72.08-.72 1.18.08 1.8 1.21 1.8 1.21 1.05 1.8 2.75 1.28 3.42.98.11-.77.41-1.29.75-1.58-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.3 1.2-3.12-.12-.3-.52-1.5.11-3.13 0 0 .97-.31 3.18 1.19a10.9 10.9 0 0 1 2.9-.39c.98 0 1.98.13 2.9.39 2.2-1.5 3.17-1.19 3.17-1.19.64 1.63.24 2.83.12 3.13.75.82 1.2 1.86 1.2 3.12 0 4.43-2.69 5.4-5.25 5.68.42.36.8 1.09.8 2.2 0 1.59-.02 2.88-.02 3.27 0 .32.21.7.81.57A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
                </svg>
                GitHub
              </a>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className="uppercase tracking-[0.08em] text-slate-400">Legal:</span>
              <Link
                to="/privacy"
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 transition hover:border-ember hover:text-ember"
              >
                Privacy
              </Link>
              <Link
                to="/terms"
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 transition hover:border-ember hover:text-ember"
              >
                Terms
              </Link>
              <Link
                to="/cookies"
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 transition hover:border-ember hover:text-ember"
              >
                Cookie Notice
              </Link>
            </div>
          </div>
          <form
            onSubmit={emailForm.handleSubmit((values) => signupMutation.mutate(values))}
            className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
          >
            <input
              type="email"
              placeholder="you@example.com"
              className="w-full rounded-full border border-tide/25 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-0 transition placeholder:text-slate-400 focus:border-ember sm:text-sm"
              {...emailForm.register("email", { required: true })}
            />
            <button
              type="submit"
              disabled={signupMutation.isPending}
              className="w-full rounded-full bg-ember px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-sm transition hover:brightness-110 disabled:opacity-60 sm:w-auto"
            >
              {signupMutation.isPending ? "Saving..." : "Notify Me"}
            </button>
          </form>
        </div>
      </motion.footer>
    </div>
  );
}
