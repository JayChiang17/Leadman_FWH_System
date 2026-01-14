
// src/components/ErrorModal.js
import React from "react";
import "./ErrorModal.css";

export default function ErrorModal({ message, onClose }) {
  if (!message) return null;

  return (
    <div className="err-modal-overlay" onClick={onClose}>
      <div className="err-modal" onClick={(e) => e.stopPropagation()}>
        <h2>⚠️ Error</h2>
        <p>{message}</p>
        <button className="err-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}