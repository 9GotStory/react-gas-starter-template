import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as gasClient from './api/gasClient';

function renderApp() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('announces loading status and renders empty state when GAS returns no items', async () => {
    vi.spyOn(gasClient, 'fetchItems').mockResolvedValueOnce([]);
    renderApp();

    const loadingStatus = screen.getByRole('status');
    expect(loadingStatus).toHaveTextContent(/loading items/i);
    expect(screen.getByRole('region', { name: /^items$/i })).toHaveAttribute('aria-busy', 'true');

    expect(await screen.findByText(/no items found/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^items$/i })).toHaveAttribute('aria-busy', 'false');
  });

  it('renders fetched items in a semantic list preserving leading-zero codes', async () => {
    vi.spyOn(gasClient, 'fetchItems').mockResolvedValueOnce([
      {
        id: '1',
        code: '0042',
        name: 'Sample Widget',
        createdAt: '2026-11-20T00:00:00.000Z',
      },
    ]);
    renderApp();

    const list = await screen.findByRole('list');
    expect(list).toBeInTheDocument();
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(1);
    expect(listItems[0]).toHaveTextContent('0042');
    expect(listItems[0]).toHaveTextContent('Sample Widget');
  });

  it('announces load failures in an accessible alert region', async () => {
    vi.spyOn(gasClient, 'fetchItems').mockRejectedValueOnce(new Error('Network down'));
    renderApp();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/failed to load items: network down/i);
  });

  it('creates an item through labeled form inputs, preserves leading zeros, and refreshes the list', async () => {
    const createdItem: gasClient.ItemDto = {
      id: 'item-2',
      code: '00123',
      name: 'Leading Zero Widget',
      createdAt: '2026-11-27T00:00:00.000Z',
    };

    vi.spyOn(gasClient, 'fetchItems')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdItem]);
    const createItemSpy = vi.spyOn(gasClient, 'createItem').mockResolvedValueOnce(createdItem);

    renderApp();
    expect(await screen.findByText(/no items found/i)).toBeInTheDocument();

    const codeInput = screen.getByLabelText(/item code/i);
    const nameInput = screen.getByLabelText(/item name/i);
    const saveButton = screen.getByRole('button', { name: /^save$/i });

    fireEvent.change(codeInput, { target: { value: '  00123  ' } });
    fireEvent.change(nameInput, { target: { value: '  Leading Zero Widget  ' } });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(createItemSpy).toHaveBeenCalledWith({
        code: '00123',
        name: 'Leading Zero Widget',
      });
    });

    expect(await screen.findByText('00123')).toBeInTheDocument();
    expect(screen.getByText('Leading Zero Widget')).toBeInTheDocument();
    expect(codeInput).toHaveValue('');
    expect(nameInput).toHaveValue('');
  });

  it('shows an accessible validation alert and skips submission when required fields are blank', async () => {
    vi.spyOn(gasClient, 'fetchItems').mockResolvedValueOnce([]);
    const createItemSpy = vi.spyOn(gasClient, 'createItem');

    renderApp();
    expect(await screen.findByText(/no items found/i)).toBeInTheDocument();

    const codeInput = screen.getByLabelText(/item code/i);
    const nameInput = screen.getByLabelText(/item name/i);
    const saveButton = screen.getByRole('button', { name: /^save$/i });

    fireEvent.change(codeInput, { target: { value: '   ' } });
    fireEvent.click(saveButton);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/both item code and item name are required/i);
    expect(codeInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(createItemSpy).not.toHaveBeenCalled();

    fireEvent.change(codeInput, { target: { value: '009' } });
    expect(codeInput).toHaveAttribute('aria-invalid', 'false');
  });

  it('disables submission while a create mutation is in flight and prevents duplicate submits', async () => {
    vi.spyOn(gasClient, 'fetchItems').mockResolvedValue([]);

    let resolveCreate!: (value: gasClient.ItemDto) => void;
    const pendingCreate = new Promise<gasClient.ItemDto>((resolve) => {
      resolveCreate = resolve;
    });
    const createItemSpy = vi.spyOn(gasClient, 'createItem').mockReturnValueOnce(pendingCreate);

    renderApp();
    expect(await screen.findByText(/no items found/i)).toBeInTheDocument();

    const codeInput = screen.getByLabelText(/item code/i);
    const nameInput = screen.getByLabelText(/item name/i);
    fireEvent.change(codeInput, { target: { value: '007' } });
    fireEvent.change(nameInput, { target: { value: 'In-flight Item' } });

    const form = codeInput.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    const savingButton = await screen.findByRole('button', { name: /saving/i });
    expect(savingButton).toBeDisabled();
    expect(form).toHaveAttribute('aria-busy', 'true');

    // Attempt a duplicate submit while the first mutation is still pending
    fireEvent.submit(form!);
    expect(createItemSpy).toHaveBeenCalledTimes(1);

    resolveCreate({
      id: 'item-3',
      code: '007',
      name: 'In-flight Item',
      createdAt: '2026-11-27T00:00:00.000Z',
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
    });
    expect(form).toHaveAttribute('aria-busy', 'false');
  });

  it('announces server create errors in an accessible alert and preserves entered values', async () => {
    vi.spyOn(gasClient, 'fetchItems').mockResolvedValueOnce([]);
    vi.spyOn(gasClient, 'createItem').mockRejectedValueOnce(
      new gasClient.GasApiError('VALIDATION_ERROR', 'code must not exceed 64 characters'),
    );

    renderApp();
    expect(await screen.findByText(/no items found/i)).toBeInTheDocument();

    const codeInput = screen.getByLabelText(/item code/i);
    const nameInput = screen.getByLabelText(/item name/i);
    fireEvent.change(codeInput, { target: { value: '00123' } });
    fireEvent.change(nameInput, { target: { value: 'Widget' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/code must not exceed 64 characters/i);
    expect(codeInput).toHaveValue('00123');
    expect(nameInput).toHaveValue('Widget');
  });
});
