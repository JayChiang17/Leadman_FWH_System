import React, { useEffect, useState } from 'react';
import './FlipClockTimer.css';

export default function FlipClockTimer({ seconds = 0 }) {
  const [elapsed, setElapsed] = useState(seconds);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((prevTime) => prevTime + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDigits = (s) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return [...h, ...m, ...sec];
  };

  const digits = formatDigits(elapsed);

  return (
    <div className="flipclock">
      {digits.map((digit, i) => (
        <React.Fragment key={i}>
          <FlipDigit digit={digit} />
          {(i === 1 || i === 3) && <div className="colon">:</div>}
        </React.Fragment>
      ))}
    </div>
  );
}

function FlipDigit({ digit }) {
  const [display, setDisplay] = useState(digit);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    setAnimate(true);
    const timeout = setTimeout(() => {
      setDisplay(digit);
      setAnimate(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [digit]);

  return (
    <div className={`flip-digit ${animate ? 'flip' : ''}`}>
      <span>{display}</span>
    </div>
  );
}