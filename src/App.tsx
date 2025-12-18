import { useEffect, useRef, useState } from 'react';
import './App.css';
import type { ChargeUpdatePayload } from './api';
import { sendChargeUpdate, startCharge, endCharge } from './api';

type SessionStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

interface ChargerState {
  soc: number; // 0-100 (percentage)
  powerW: number;
  voltageV: number;
  currentA: number;
  tempC: number;
}

const INITIAL_SOC = 20; // 20%
const TARGET_SOC = 90; // 90%
const INTERVAL_SECONDS = 1; // Update every second
const CHARGE_RATE_PER_KWH = 0.25; // $0.25 per kWh
const CHARGER_ID = 'Charger ID: King_of_the_North';

function generateNextState(prev: ChargerState): ChargerState {
  // Simple EV-style charging curve: high power initially, taper near TARGET_SOC
  // SOC increases by 1-2% per second
  const soc = Math.min(TARGET_SOC, prev.soc + 1 + Math.random() * 1);

  // Base voltage around 400V, small noise
  const voltageV = 380 + Math.random() * 40;

  // Power tapers as SOC increases (reduce after 60%)
  const socPercent = soc / 100; // Convert to 0-1 for calculations
  const socFactor = 1 - Math.max(0, socPercent - 0.6) * 1.5;
  const maxPower = 50000; // 50 kW DC fast charger (more realistic for the design)
  const powerBase = maxPower * Math.max(0.2, socFactor);
  const powerW = powerBase * (0.9 + Math.random() * 0.2);

  const currentA = powerW / voltageV;

  // Temperature rises slowly
  const tempC = prev.tempC + (Math.random() * 0.5);

  return { soc, powerW, voltageV, currentA, tempC };
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatTime12Hour(): string {
  const now = new Date();
  const hours = now.getHours() % 12 || 12;
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
  return `${hours}:${minutes} ${ampm}`;
}

function CircularGauge({ percentage }: { percentage: number }) {
  const radius = 120;
  const circumference = 2 * Math.PI * radius;
  const normalizedPercentage = Math.min(100, Math.max(0, percentage));
  const offset = circumference - (normalizedPercentage / 100) * circumference;

  return (
    <div className="circular-gauge">
      <svg width="280" height="280" viewBox="0 0 280 280">
        {/* Background circle */}
        <circle
          cx="140"
          cy="140"
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth="20"
        />
        {/* Progress circle */}
        <circle
          cx="140"
          cy="140"
          r={radius}
          fill="none"
          stroke="#00ff88"
          strokeWidth="20"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 140 140)"
          className="gauge-progress"
        />
      </svg>
      <div className="gauge-content">
        <div className="gauge-status">ACTIVE</div>
        <div className="gauge-value">{Math.round(normalizedPercentage)}</div>
        <div className="gauge-label">STATE OF CHARGE</div>
      </div>
    </div>
  );
}

function App() {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [chargerState, setChargerState] = useState<ChargerState>({
    soc: INITIAL_SOC,
    powerW: 0,
    voltageV: 400,
    currentA: 0,
    tempC: 20,
  });
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [energyDispensed, setEnergyDispensed] = useState(0); // kWh

  const intervalRef = useRef<number | null>(null);
  const timeIntervalRef = useRef<number | null>(null);

  // Update elapsed time when running
  useEffect(() => {
    if (status === 'running' && startTime) {
      const updateElapsed = () => {
        const elapsed = Math.floor((new Date().getTime() - startTime.getTime()) / 1000);
        setElapsedSeconds(elapsed);
      };
      updateElapsed();
      timeIntervalRef.current = window.setInterval(updateElapsed, 1000);
      return () => {
        if (timeIntervalRef.current !== null) {
          window.clearInterval(timeIntervalRef.current);
        }
      };
    }
  }, [status, startTime]);

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
      }
      if (timeIntervalRef.current !== null) {
        window.clearInterval(timeIntervalRef.current);
      }
    };
  }, []);

  const startSession = async () => {
    setError(null);
    setStatus('starting');

    try {
      const sessionStartTime = new Date();
      const startedAt = sessionStartTime.toISOString();
      const { transaction_id } = await startCharge(startedAt, parseFloat(INITIAL_SOC.toFixed(2)));
      setTransactionId(transaction_id);
      setStartTime(sessionStartTime);
      setElapsedSeconds(0);
      setEnergyDispensed(0);
      setStatus('running');

      // Immediately send first update and then every INTERVAL_SECONDS
      const sendUpdate = async () => {
        setChargerState((prev) => {
          const next = generateNextState(prev);
          
          // Calculate energy dispensed (kWh) - power in kW * time in hours
          const powerKW = next.powerW / 1000;
          const timeHours = INTERVAL_SECONDS / 3600;
          const energyIncrement = powerKW * timeHours;
          setEnergyDispensed((prev) => prev + energyIncrement);

          const payload: ChargeUpdatePayload = {
            sample_time_increment: INTERVAL_SECONDS,
            soc: parseFloat(next.soc.toFixed(2)),
            temp_c: parseFloat(next.tempC.toFixed(2)),
            avg_power_w: parseFloat(next.powerW.toFixed(2)),
            avg_current_a: parseFloat(next.currentA.toFixed(2)),
            avg_voltage_v: parseFloat(next.voltageV.toFixed(2)),
          };

          if (transaction_id) {
            sendChargeUpdate(transaction_id, payload).catch((e) => {
              console.error(e);
              setError(e.message);
              setStatus('error');
            });
          }

          return next;
        });
      };

      await sendUpdate();

      intervalRef.current = window.setInterval(() => {
        sendUpdate();
      }, INTERVAL_SECONDS * 1000);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? 'Failed to start session');
      setStatus('error');
    }
  };

  const stopSession = async () => {
    setStatus('stopping');
    
    // Stop intervals
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeIntervalRef.current !== null) {
      window.clearInterval(timeIntervalRef.current);
      timeIntervalRef.current = null;
    }

    // Notify backend that charging has ended with final metrics
    if (transactionId) {
      try {
        const finalPayload: ChargeUpdatePayload = {
          sample_time_increment: INTERVAL_SECONDS,
          soc: parseFloat(chargerState.soc.toFixed(2)),
          temp_c: parseFloat(chargerState.tempC.toFixed(2)),
          avg_power_w: parseFloat(chargerState.powerW.toFixed(2)),
          avg_current_a: parseFloat(chargerState.currentA.toFixed(2)),
          avg_voltage_v: parseFloat(chargerState.voltageV.toFixed(2)),
        };
        await endCharge(transactionId, finalPayload);
      } catch (e: any) {
        console.error('Failed to end charge session:', e);
        // Continue with reset even if API call fails
      }
    }

    // Reset state
    setStatus('idle');
    setTransactionId(null);
    setStartTime(null);
    setElapsedSeconds(0);
    setEnergyDispensed(0);
    setChargerState({
      soc: INITIAL_SOC,
      powerW: 0,
      voltageV: 400,
      currentA: 0,
      tempC: 20,
    });
  };

  const isRunning = status === 'running';
  const estimatedCost = energyDispensed * CHARGE_RATE_PER_KWH;
  const powerKW = chargerState.powerW / 1000;

  return (
    <div className="ev-charger-app">
      {/* Header */}
      <header className="ev-header">
        <div className="header-time">{formatTime12Hour()}</div>
        <div className="header-title">EV CHARGER</div>
        <div className="header-id">{CHARGER_ID}</div>
      </header>

      {/* Charging Session Status */}
      {isRunning && (
        <div className="session-status">
          <span>Charging Session</span>
          <span className="session-icon">▶▶</span>
        </div>
      )}

      {/* Main Content */}
      <main className="ev-main-layout">
        {/* Left Panel */}
        <section className="ev-panel ev-panel-left">
          <div className="metric-box">
            <div className="metric-header">
              <span className="metric-label">Time Elapsed</span>
              <span className="metric-value">{formatTime(elapsedSeconds)}</span>
            </div>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${Math.min(100, (elapsedSeconds / 3600) * 100)}%` }}
              />
            </div>
          </div>

          <div className="metric-box">
            <div className="metric-header">
              <span className="metric-label">Energy Dispensed</span>
              <span className="metric-value">{energyDispensed.toFixed(1)} kWh</span>
            </div>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${Math.min(100, (energyDispensed / 100) * 100)}%` }}
              />
            </div>
          </div>

          <button className="ev-button ev-button-info" onClick={() => alert('Session Info: Transaction ID: ' + (transactionId || 'N/A'))}>
            SESSION INFO
          </button>
        </section>

        {/* Center - Circular Gauge */}
        <section className="ev-panel ev-panel-center">
          <CircularGauge percentage={chargerState.soc} />
        </section>

        {/* Right Panel */}
        <section className="ev-panel ev-panel-right">
          <div className="metric-box">
            <div className="metric-header">
              <span className="metric-label">Power</span>
              <span className="metric-value">{powerKW.toFixed(0)} kW</span>
            </div>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${Math.min(100, (powerKW / 50) * 100)}%` }}
              />
            </div>
          </div>

          <div className="metric-box">
            <div className="metric-header">
              <span className="metric-label">Estimated Cost</span>
              <span className="metric-value">${estimatedCost.toFixed(2)}</span>
            </div>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${Math.min(100, (estimatedCost / 20) * 100)}%` }}
              />
            </div>
          </div>

          <button 
            className="ev-button ev-button-end" 
            onClick={stopSession}
            disabled={!isRunning}
          >
            END SESSION
          </button>
        </section>
      </main>

      {/* Start Button (when idle) */}
      {!isRunning && (
        <div className="start-section">
          <button 
            className="ev-button ev-button-start" 
            onClick={startSession}
            disabled={status === 'starting'}
          >
            {status === 'starting' ? 'Starting...' : 'START CHARGING'}
          </button>
          {error && <div className="error-message">{error}</div>}
        </div>
      )}

      {/* Footer */}
      <footer className="ev-footer">
        <div className="footer-id">{CHARGER_ID}</div>
      </footer>
    </div>
  );
}

export default App;
