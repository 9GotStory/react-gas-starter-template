import { useState, type FormEvent } from 'react';
import { useCreateItem, useItems } from './hooks/useItems';

export function App() {
  const { data: items, isLoading, isError, error } = useItems();
  const createItemMutation = useCreateItem();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [validationAttempted, setValidationAttempted] = useState(false);

  const trimmedCode = code.trim();
  const trimmedName = name.trim();
  const hasCodeError = validationAttempted && trimmedCode.length === 0;
  const hasNameError = validationAttempted && trimmedName.length === 0;
  const validationError =
    hasCodeError || hasNameError ? 'Both item code and item name are required.' : null;
  const formErrorMessage =
    validationError ?? (createItemMutation.isError ? createItemMutation.error.message : null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createItemMutation.isPending) {
      return;
    }

    if (!trimmedCode || !trimmedName) {
      setValidationAttempted(true);
      return;
    }

    setValidationAttempted(false);
    createItemMutation.mutate(
      { code: trimmedCode, name: trimmedName },
      {
        onSuccess: () => {
          setCode('');
          setName('');
          setValidationAttempted(false);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          React + GAS Starter Template
        </h1>
        <p className="mt-1 text-sm text-slate-700">
          TanStack Query + Google Apps Script Web App API + Google Sheets
        </p>
      </header>

      <main className="space-y-8">
        <section
          aria-labelledby="add-item-heading"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs"
        >
          <h2 id="add-item-heading" className="mb-4 text-base font-semibold text-slate-900">
            Add Item
          </h2>
          <form
            onSubmit={handleSubmit}
            noValidate
            aria-busy={createItemMutation.isPending}
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
          >
            <div className="flex flex-col gap-1.5 sm:w-44">
              <label htmlFor="item-code" className="text-sm font-medium text-slate-800">
                Item code
              </label>
              <input
                id="item-code"
                name="code"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="e.g. 00123"
                autoComplete="off"
                aria-required="true"
                aria-invalid={hasCodeError}
                aria-describedby={formErrorMessage ? 'item-form-error' : undefined}
                className="min-h-11 rounded-md border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-[invalid=true]:border-red-600"
              />
            </div>

            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="item-name" className="text-sm font-medium text-slate-800">
                Item name
              </label>
              <input
                id="item-name"
                name="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter item name"
                autoComplete="off"
                aria-required="true"
                aria-invalid={hasNameError}
                aria-describedby={formErrorMessage ? 'item-form-error' : undefined}
                className="min-h-11 rounded-md border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-[invalid=true]:border-red-600"
              />
            </div>

            <button
              type="submit"
              disabled={createItemMutation.isPending}
              className="min-h-11 w-full rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {createItemMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </form>

          {formErrorMessage && (
            <p id="item-form-error" role="alert" className="mt-3 text-sm font-medium text-red-700">
              {formErrorMessage}
            </p>
          )}
        </section>

        <section
          aria-labelledby="items-heading"
          aria-busy={isLoading}
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs"
        >
          <h2 id="items-heading" className="mb-3 text-base font-semibold text-slate-900">
            Items
          </h2>

          {isLoading && (
            <p role="status" aria-live="polite" className="text-sm text-slate-700">
              Loading items...
            </p>
          )}

          {isError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              Failed to load items: {error.message}
            </div>
          )}

          {!isLoading && !isError && (!items || items.length === 0) && (
            <p className="text-sm text-slate-700">No items found.</p>
          )}

          {!isLoading && !isError && items && items.length > 0 && (
            <ul className="divide-y divide-slate-200">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 break-words">
                    <span className="font-mono text-xs font-medium text-slate-700">
                      {item.code}
                    </span>
                    <span className="font-medium text-slate-900">{item.name}</span>
                  </div>
                  <span className="text-xs text-slate-600">{item.createdAt}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
