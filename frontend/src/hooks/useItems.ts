import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createItem, fetchItems, type CreateItemInput } from '../api/gasClient';

export const ITEMS_QUERY_KEY = ['items'] as const;

export function useItems() {
  return useQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: ({ signal }) => fetchItems({ signal }),
  });
}

export function useCreateItem() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateItemInput) => createItem(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
    },
  });
}
