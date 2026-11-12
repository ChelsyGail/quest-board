import { useEffect, useMemo, useRef, useState } from "react";
import {
  eligibilityLabel,
  getRewardsClient,
  rewardsMode,
  rewardsUnavailableMessage,
} from "./rewards.js";

function AchievementsSummary({ achievements }) {
  if (!achievements) return null;
  return (
    <div className="achievements-summary" aria-label="Your points and badges">
      <p>
        <strong>{achievements.earnedPoints}</strong> earned points ·{" "}
        <strong>{achievements.spendablePoints}</strong> spendable
      </p>
      {achievements.badges?.length > 0 ? (
        <ul className="badge-list">
          {achievements.badges.map((badge) => (
            <li key={badge.id}>
              <span className="badge badge-achievement">{badge.name}</span>
              <span className="muted small">{badge.description}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No badges yet. Approved quests earn points and badges.</p>
      )}
    </div>
  );
}

function useStableRewardsClient(session) {
  const mode = rewardsMode();
  return useMemo(
    () => getRewardsClient(session),
    // mode is env-stable for a running DEV session; token/user identity drive reloads.
    [session?.token, session?.userId, mode]
  );
}

export function ProfileAchievements({ session, onSessionExpired }) {
  const client = useStableRewardsClient(session);
  const onExpiredRef = useRef(onSessionExpired);
  onExpiredRef.current = onSessionExpired;
  const [achievements, setAchievements] = useState(null);
  const [status, setStatus] = useState(client ? "loading" : "unavailable");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!client) {
      setStatus("unavailable");
      setAchievements(null);
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    setError("");
    (async () => {
      try {
        const data = await client.getAchievements();
        if (cancelled) return;
        setAchievements(data);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        if (err.status === 401) {
          onExpiredRef.current?.();
          return;
        }
        setError(err.message || "Couldn't load achievements.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, session.userId, session.token]);

  if (!client) {
    return (
      <section className="section panel" aria-labelledby="achievements-title">
        <h3 className="section-title" id="achievements-title">
          Achievements
        </h3>
        <p className="muted">{rewardsUnavailableMessage()}</p>
      </section>
    );
  }

  return (
    <section className="section panel" aria-labelledby="achievements-title">
      <h3 className="section-title" id="achievements-title">
        Achievements
      </h3>
      {client.isDemo && (
        <p className="notice" role="note">
          Development sample — balances stay in this browser tab.
        </p>
      )}
      {status === "loading" && <p className="muted">Loading…</p>}
      {status === "error" && (
        <p className="form-error form-error-left" role="alert">
          {error}
        </p>
      )}
      {status === "ready" && <AchievementsSummary achievements={achievements} />}
    </section>
  );
}

function RewardsPage({ session, onSessionExpired }) {
  const client = useStableRewardsClient(session);
  const onExpiredRef = useRef(onSessionExpired);
  onExpiredRef.current = onSessionExpired;
  const [achievements, setAchievements] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [status, setStatus] = useState(client ? "loading" : "unavailable");
  const [error, setError] = useState("");
  const [claimingId, setClaimingId] = useState(null);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const loadGen = useRef(0);

  async function reload({ soft = false } = {}) {
    if (!client) return;
    const gen = ++loadGen.current;
    const userId = session.userId;
    if (soft && status === "ready") setRefreshing(true);
    else {
      setStatus("loading");
      setError("");
    }
    try {
      const [ach, list] = await Promise.all([client.getAchievements(), client.listRewards()]);
      if (gen !== loadGen.current || userId !== session.userId) return;
      setAchievements(ach);
      setRewards(list);
      setStatus("ready");
      setError("");
    } catch (err) {
      if (gen !== loadGen.current || userId !== session.userId) return;
      if (err.status === 401) {
        onExpiredRef.current?.();
        return;
      }
      setError(err.message || "Couldn't load rewards.");
      if (!soft) setStatus("error");
    } finally {
      if (gen === loadGen.current) setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!client) {
      setStatus("unavailable");
      return undefined;
    }
    let cancelled = false;
    (async () => {
      await reload({ soft: false });
      if (cancelled) {
        // reload already finished; generation guard handles stale writes
      }
    })();
    return () => {
      cancelled = true;
      loadGen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when identity changes
  }, [client, session.userId, session.token]);

  if (!client) {
    return (
      <section className="section panel">
        <h2 className="section-title">Rewards</h2>
        <p className="muted">{rewardsUnavailableMessage()}</p>
      </section>
    );
  }

  async function claim(rewardId) {
    if (claimingId) return;
    const userId = session.userId;
    setClaimingId(rewardId);
    setNotice("");
    setError("");
    try {
      const result = await client.claimReward(rewardId);
      if (userId !== session.userId) return;
      setAchievements(result.achievements);
      setRewards((current) =>
        current.map((reward) => (reward.id === rewardId ? result.reward : reward))
      );
      setNotice(`Claimed “${result.reward.title}”. Your spendable balance was updated.`);
    } catch (err) {
      if (userId !== session.userId) return;
      if (err.status === 401) {
        onExpiredRef.current?.();
        return;
      }
      if (err.resultUnknown) {
        await reload({ soft: true });
        setError("We couldn't confirm the claim. Your balance above was refreshed.");
      } else {
        setError(err.message || "Couldn't claim that reward.");
      }
    } finally {
      if (userId === session.userId) setClaimingId(null);
    }
  }

  return (
    <section className="section panel" aria-labelledby="rewards-title">
      <div className="section-heading-row">
        <h2 className="section-title" id="rewards-title">
          Rewards
        </h2>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => reload({ soft: true })}
          disabled={refreshing || status === "loading"}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {client.isDemo && (
        <p className="notice" role="note">
          Development sample — claims stay in this browser tab.
        </p>
      )}
      {status === "loading" && <p className="muted">Loading rewards…</p>}
      {status === "error" && (
        <p className="form-error form-error-left" role="alert">
          {error}
        </p>
      )}
      {status === "ready" && (
        <>
          {refreshing && (
            <p className="muted small" role="status">
              Refreshing balances…
            </p>
          )}
          <AchievementsSummary achievements={achievements} />
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="form-error form-error-left" role="alert">
              {error}
            </p>
          )}
          {rewards.length === 0 ? (
            <p className="muted">No rewards published yet.</p>
          ) : (
            <ul className="rewards-list">
              {rewards.map((reward) => (
                <li key={reward.id} className="reward-card">
                  <div>
                    <h3 className="small-title">{reward.title}</h3>
                    <p>{reward.description}</p>
                    <p className="muted small">
                      Cost: {reward.costPoints} pts · {reward.requirements}
                    </p>
                    <p>
                      <span className={`badge status-${reward.eligibility}`}>
                        {eligibilityLabel(reward.eligibility)}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button button-small"
                    disabled={reward.eligibility !== "eligible" || claimingId === reward.id}
                    onClick={() => claim(reward.id)}
                  >
                    {claimingId === reward.id
                      ? "Claiming…"
                      : reward.claimed
                        ? "Claimed"
                        : "Claim"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function OrganizerRewards({ session, onSessionExpired }) {
  const client = useStableRewardsClient(session);
  const onExpiredRef = useRef(onSessionExpired);
  onExpiredRef.current = onSessionExpired;
  const [mine, setMine] = useState([]);
  const [claims, setClaims] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    costPoints: "20",
    requirements: "",
    requiresApprovedQuest: true,
  });
  const [status, setStatus] = useState(client ? "loading" : "unavailable");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadGen = useRef(0);
  const selectedRef = useRef("");

  async function reload({ soft = false } = {}) {
    if (!client) return;
    const gen = ++loadGen.current;
    const userId = session.userId;
    if (soft && status === "ready") setRefreshing(true);
    else setStatus("loading");
    try {
      const list = await client.listMyRewards();
      if (gen !== loadGen.current || userId !== session.userId) return;
      setMine(list);
      setStatus("ready");
      setError("");
    } catch (err) {
      if (gen !== loadGen.current || userId !== session.userId) return;
      if (err.status === 401) onExpiredRef.current?.();
      else {
        setError(err.message || "Couldn't load your rewards.");
        if (!soft) setStatus("error");
      }
    } finally {
      if (gen === loadGen.current) setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!client) {
      setStatus("unavailable");
      return undefined;
    }
    reload({ soft: false });
    return () => {
      loadGen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, session.userId, session.token]);

  if (!client) {
    return (
      <section className="section panel">
        <h2 className="section-title">Organizer rewards</h2>
        <p className="muted">{rewardsUnavailableMessage()}</p>
      </section>
    );
  }

  async function createReward(event) {
    event.preventDefault();
    if (saving) return;
    const userId = session.userId;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await client.createReward({
        ...form,
        costPoints: Number(form.costPoints),
      });
      if (userId !== session.userId) return;
      setMine((current) => [...current, created]);
      setNotice(`Created “${created.title}”.`);
      setForm({
        title: "",
        description: "",
        costPoints: "20",
        requirements: "",
        requiresApprovedQuest: true,
      });
    } catch (err) {
      if (userId !== session.userId) return;
      if (err.status === 401) onExpiredRef.current?.();
      else setError(err.message || "Couldn't create the reward.");
    } finally {
      if (userId === session.userId) setSaving(false);
    }
  }

  async function showClaims(rewardId) {
    if (loadingClaims) return;
    const userId = session.userId;
    selectedRef.current = rewardId;
    setSelectedId(rewardId);
    setClaims([]);
    setLoadingClaims(true);
    try {
      const list = await client.listClaims(rewardId);
      if (userId !== session.userId || selectedRef.current !== rewardId) return;
      setClaims(list);
    } catch (err) {
      if (userId !== session.userId || selectedRef.current !== rewardId) return;
      if (err.status === 401) onExpiredRef.current?.();
      else setError(err.message || "Couldn't load claims.");
    } finally {
      if (userId === session.userId && selectedRef.current === rewardId) {
        setLoadingClaims(false);
      }
    }
  }

  return (
    <section className="section panel" aria-labelledby="org-rewards-title">
      <div className="section-heading-row">
        <h2 className="section-title" id="org-rewards-title">
          Organizer rewards
        </h2>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => reload({ soft: true })}
          disabled={refreshing || status === "loading"}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {client.isDemo && (
        <p className="notice" role="note">
          Development sample — organizer rewards stay in this browser tab.
        </p>
      )}
      <form className="stack-form" onSubmit={createReward}>
        <label className="field">
          <span>Title</span>
          <input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            disabled={saving}
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            rows={3}
            disabled={saving}
          />
        </label>
        <label className="field">
          <span>Cost (points)</span>
          <input
            value={form.costPoints}
            onChange={(event) => setForm({ ...form, costPoints: event.target.value })}
            disabled={saving}
          />
        </label>
        <label className="field">
          <span>Requirements</span>
          <input
            value={form.requirements}
            onChange={(event) => setForm({ ...form, requirements: event.target.value })}
            disabled={saving}
          />
        </label>
        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={form.requiresApprovedQuest}
            onChange={(event) =>
              setForm({ ...form, requiresApprovedQuest: event.target.checked })
            }
            disabled={saving}
          />
          <span>Require at least one approved quest</span>
        </label>
        <button type="submit" className="button" disabled={saving}>
          {saving ? "Saving…" : "Create reward"}
        </button>
      </form>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error form-error-left" role="alert">
          {error}
        </p>
      )}
      {status === "ready" && (
        <ul className="rewards-list">
          {mine.map((reward) => (
            <li key={reward.id} className="reward-card">
              <div>
                <h3 className="small-title">{reward.title}</h3>
                <p className="muted small">
                  {reward.costPoints} pts · {reward.requirements}
                </p>
              </div>
              <button
                type="button"
                className="button button-secondary button-small"
                disabled={loadingClaims}
                onClick={() => showClaims(reward.id)}
              >
                Claims
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedId && (
        <div className="claims-panel" aria-live="polite">
          <h3 className="small-title">Claims for reward #{selectedId}</h3>
          {loadingClaims ? (
            <p className="muted">Loading claims…</p>
          ) : claims.length === 0 ? (
            <p className="muted">No claims yet.</p>
          ) : (
            <ul>
              {claims.map((claim) => (
                <li key={`${claim.userId}-${claim.claimedAt}`}>
                  {claim.name || claim.userId} ·{" "}
                  {claim.claimedAt ? new Date(claim.claimedAt).toLocaleString() : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default RewardsPage;
