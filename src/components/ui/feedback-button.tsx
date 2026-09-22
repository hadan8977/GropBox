"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** The caller owns the operation, errors, success timeout, and live announcement. */
export function FeedbackButton({ state, label, successLabel, icon, successIcon, className = "", disabled, ...props }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "aria-busy" | "title"> & {
    state: "idle" | "pending" | "success"; label: string; successLabel: string;
    icon: ReactNode; successIcon: ReactNode;
  }) {
  return <button {...props} type={props.type ?? "button"} className={`bui-feedback ${className}`}
    disabled={disabled || state === "pending"} aria-label={label} aria-busy={state === "pending"}
    title={state === "success" ? successLabel : label} data-success={state === "success" || undefined}>
    <span className="bui-feedback-idle" aria-hidden="true">{icon}</span>
    <span className="bui-feedback-success" aria-hidden="true">{successIcon}</span>
  </button>;
}
