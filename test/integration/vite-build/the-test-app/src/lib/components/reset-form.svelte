<script lang="ts">
	import { page } from '$app/stores';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import type { ActionResult } from '@sveltejs/kit';
	import { createEventDispatcher } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { superForm } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import { resetSchema } from '../schemas';
	import { Button } from './ui/button';

	export let changeState: ((state: string) => void) | undefined = undefined;

	const dispatch = createEventDispatcher<{ result: ActionResult }>();

	let form = superForm({} as any, {
		validators: zodClient(resetSchema),
		invalidateAll: false,
		onResult: ({ result }) => {
			dispatch('result', result);

			if (result.type === 'failure' && result.data?.message) {
				toast.error(result.data?.message);
			} else if (result.type === 'success' || result.type === 'redirect') {
				toast.success('Password reset successful.');
			}
		},
	});

	const { form: formData, enhance: enhance } = form;
</script>

<form action="/reset{$page.url.search}" class="flex flex-col space-y-3" method="POST" use:enhance>
	<div class="flex flex-col">
		<Form.Field {form} name="password">
			<Form.Control let:attrs>
				<Form.Label>New Password</Form.Label>
				<Input
					{...attrs}
					autocomplete="new-password"
					bind:value={$formData.password}
					type="password"
				/>
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="confirmPassword">
			<Form.Control let:attrs>
				<Form.Label>Confirm Password</Form.Label>
				<Input
					{...attrs}
					autocomplete="new-password"
					bind:value={$formData.confirmPassword}
					type="password"
				/>
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="code">
			<Form.Control let:attrs>
				<Form.Label>Recovery code</Form.Label>
				<Input {...attrs} bind:value={$formData.code} />
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<div class="flex justify-between">
		<Button
			class="h-fit p-0 text-sm"
			href="/login{$page.url.search}"
			on:click={(ev) => {
				if (changeState && typeof changeState == 'function') {
					ev.preventDefault();
					changeState('login');
				}
			}}
			variant="link"
		>
			Login
		</Button>
		<Button
			class="h-fit p-0 text-sm"
			href="/register{$page.url.search}"
			on:click={(ev) => {
				if (changeState && typeof changeState == 'function') {
					ev.preventDefault();
					changeState('register');
				}
			}}
			variant="link"
		>
			Create an account
		</Button>
	</div>

	<Form.Button class="w-full">Reset Password</Form.Button>

	<Button
		class="mx-auto"
		href="/recover{$page.url.search}"
		on:click={(ev) => {
			if (changeState && typeof changeState == 'function') {
				ev.preventDefault();
				changeState('recover');
			}
		}}
		variant="link"
	>
		I don't have a recovery code
	</Button>
</form>
