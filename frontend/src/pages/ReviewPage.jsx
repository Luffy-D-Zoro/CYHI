import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';

export default function ReviewPage() {
  const { formId } = useParams();
  const [searchParams] = useSearchParams();
  const teamId = searchParams.get('teamId');

  const [members, setMembers] = useState([]);
  const [assignments, setAssignments] = useState([]); // flat rows, source of truth
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // fieldId currently being moved, so we can disable it and avoid double-drops.
  const [pendingFieldId, setPendingFieldId] = useState(null);
  const [dragFieldId, setDragFieldId] = useState(null);
  const [actionError, setActionError] = useState('');

  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const [confirmError, setConfirmError] = useState('');

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiFetch(
        `/api/forms/${formId}/assignments?teamId=${encodeURIComponent(teamId || '')}`
      );
      setAssignments(data.assignments || []);
      setMembers(
        (data.grouped || []).map((g) => ({
          memberId: g.memberId,
          email: g.email,
          role: g.role,
          isLeader: g.isLeader,
        }))
      );
    } catch (err) {
      setLoadError(err.message || 'Failed to load the assignment review board.');
    } finally {
      setLoading(false);
    }
  }, [formId, teamId]);

  useEffect(() => {
    if (!formId || !teamId) {
      setLoadError('Missing formId or teamId in the review link.');
      setLoading(false);
      return;
    }
    loadBoard();
  }, [formId, teamId, loadBoard]);

  // Derive per-member columns from the flat assignment list — a single
  // source of truth means a PATCH response only has to update one row here
  // for the whole board to stay consistent.
  const columns = useMemo(() => {
    return members.map((member) => ({
      ...member,
      fields: assignments.filter((a) => String(a.memberId) === String(member.memberId)),
    }));
  }, [members, assignments]);

  const allFieldsAssigned = assignments.length > 0 && assignments.every((a) => a.memberId);

  function handleDragStart(fieldId) {
    setActionError('');
    setDragFieldId(fieldId);
  }

  async function handleDrop(targetMemberId) {
    const fieldId = dragFieldId;
    setDragFieldId(null);
    if (!fieldId) return;

    const current = assignments.find((a) => a.fieldId === fieldId);
    if (!current || String(current.memberId) === String(targetMemberId)) return;

    setPendingFieldId(fieldId);
    setActionError('');

    try {
      const result = await apiFetch(`/api/forms/${formId}/assignments/${encodeURIComponent(fieldId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ teamId, memberId: targetMemberId }),
      });

      // Only move the card in the UI now that the backend has confirmed it.
      setAssignments((prev) =>
        prev.map((a) =>
          a.fieldId === fieldId
            ? {
                ...a,
                memberId: result.assignment.memberId,
                source: result.assignment.source,
                confidence: result.assignment.confidence ?? null,
                reason: result.assignment.reason,
                status: result.assignment.status,
              }
            : a
        )
      );
    } catch (err) {
      // Nothing was moved locally, so the previous UI state is already intact.
      setActionError(err.message || 'Failed to move this field.');
    } finally {
      setPendingFieldId(null);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    setConfirmError('');
    setConfirmResult(null);
    try {
      const data = await apiFetch(`/api/collaborations/${teamId}/invitations/send`, {
        method: 'POST',
      });
      setConfirmResult(data);
    } catch (err) {
      setConfirmError(err.message || 'Failed to send invitations.');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading review board...</div>;
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-red-50 border border-red-200 rounded-md p-4 text-center">
          <p className="text-red-800 text-sm font-medium mb-3">{loadError}</p>
          <button
            onClick={loadBoard}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-indigo-600 tracking-tight">COLLAB FORM</h1>
          <h2 className="mt-2 text-xl font-medium text-gray-900">Review field assignments</h2>
          <p className="mt-1 text-sm text-gray-500">
            Drag a field between members to reassign it. Changes save immediately.
          </p>
        </div>

        {actionError && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800 text-center">
            {actionError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {columns.map((column) => (
            <div
              key={column.memberId}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(column.memberId)}
              className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col min-h-[200px]"
            >
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {column.email} {column.isLeader && <span className="text-xs text-indigo-600 font-normal">(Leader)</span>}
                </p>
                <p className="text-xs text-gray-500 truncate">{column.role}</p>
              </div>

              <div className="p-3 flex-1 space-y-2">
                {column.fields.length === 0 && (
                  <p className="text-xs text-gray-400 italic">Drop a field here</p>
                )}
                {column.fields.map((field) => (
                  <div
                    key={field.fieldId}
                    draggable={pendingFieldId !== field.fieldId}
                    onDragStart={() => handleDragStart(field.fieldId)}
                    className={`bg-gray-50 border border-gray-200 rounded-md p-2 text-xs cursor-move ${
                      pendingFieldId === field.fieldId ? 'opacity-50' : ''
                    }`}
                  >
                    <p className="font-medium text-gray-800">{field.label || field.fieldId}</p>
                    <p className="text-gray-500">
                      {field.type}
                      {field.required ? ' · required' : ''}
                      {field.source ? ` · ${field.source}` : ''}
                    </p>
                    {pendingFieldId === field.fieldId && <p className="text-indigo-500 mt-1">Saving...</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 text-center">
          {!allFieldsAssigned && (
            <p className="text-sm text-amber-700 mb-3">
              Not every field currently has an assignment — resolve that before confirming.
            </p>
          )}

          {confirmError && (
            <div className="mb-3 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
              {confirmError}
            </div>
          )}

          {confirmResult && (
            <div
              className={`mb-3 rounded-md p-3 text-sm ${
                confirmResult.failed > 0 ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-green-50 border border-green-200 text-green-800'
              }`}
            >
              <p className="font-medium">
                {confirmResult.sent} of {confirmResult.total} invitation(s) sent successfully.
              </p>
              {confirmResult.failed > 0 && (
                <ul className="mt-2 text-left list-disc list-inside">
                  {confirmResult.results
                    .filter((r) => r.status === 'failed')
                    .map((r) => (
                      <li key={r.email}>
                        {r.email}: {r.error}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          <button
            onClick={handleConfirm}
            disabled={confirming || !allFieldsAssigned}
            className="w-full sm:w-auto px-6 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {confirming ? 'Sending invitations...' : 'Confirm Assignments & Send Invitations'}
          </button>
        </div>
      </div>
    </div>
  );
}
