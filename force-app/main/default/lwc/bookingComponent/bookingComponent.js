import { LightningElement, api, wire } from 'lwc';
import getInventoryUnits from '@salesforce/apex/SelectUnitScreenController.getUnits';
import createBookingUnits from '@salesforce/apex/SelectUnitScreenController.createBookingUnits';
import getPaymentPlanDetails from '@salesforce/apex/SelectUnitScreenController.getPaymentPlanDetails';
import createUnitPayment from '@salesforce/apex/BookingController.createUnitPayment';
import createJointOwners from '@salesforce/apex/BookingController.createJointOwners';
import getAccountAndOpportunity from '@salesforce/apex/BookUnitController.getAccountAndOpportunity';
import searchAccounts from '@salesforce/apex/BookingController.searchAccounts';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { CloseActionScreenEvent } from 'lightning/actions';
import { getRecord, getFieldValue, createRecord } from 'lightning/uiRecordApi';
import ACCOUNT_OBJECT from '@salesforce/schema/Account';
import ACCOUNT_NAME_FIELD from '@salesforce/schema/Account.Name';
import ACCOUNT_PHONE_FIELD from '@salesforce/schema/Account.Phone';
import OPPORTUNITY_NAME from '@salesforce/schema/Opportunity.Name';

const INVENTORY_COLUMNS = [
    { label: 'Inventory Name', fieldName: 'Name' }
];

const PAYMENT_PLAN_COLUMNS = [
    { label: 'Name', fieldName: 'Name' },
    { label: 'Inventory', fieldName: 'Inventory_Name__c' },
    { label: 'Sequence No', fieldName: 'Seq__c', type: 'number' },
    {
        label: 'Percent',
        fieldName: 'percentDisplay',
        type: 'percent',
        typeAttributes: {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }
    },
    { label: 'Amount', fieldName: 'Amount__c', type: 'currency' }
];

export default class BookingComponent extends LightningElement {
    @api recordId; // Opportunity Id

    // step control (1=Details, 2=Booking, 3=Ownership, 4=Payment)
    currentStep = 1;

    // ---- step 1: account & opportunity fields ----
    accountId;
    accountFields = [];
    opportunityFields = [];
    isStep1Loading = false;
    accountSaved = false;
    opportunitySaved = false;

    // booking - inventory selection (Step 2)
    inventoryUnits = [];
    inventoryColumns = INVENTORY_COLUMNS;
    selectedInventoryIds = [];
    isInventoryLoading = false;
    inventoryError;

    // booking - payment plan details (shown after Create Bookings)
    showInventorySelection = true;
    paymentPlanDetails = [];
    paymentPlanColumns = PAYMENT_PLAN_COLUMNS;

    // joint owners
    jointOwners = [];
    nextJointOwnerId = 1;

    // new account modal
    showNewAccountModal = false;
    isCreatingAccount = false;
    newAccountOwnerIndex = null;
    newAccount = { firstName: '', lastName: '', phone: '', email: '' };

    // payment
    paymentMode;
    purpose;
    amount;
    isSaving = false;

    // dynamic field bag
    payFields = {};

    /* ============ PICKLIST OPTIONS ============ */
    paymentModeOptions = [
        { label: 'Credit Card', value: 'Credit Card' },
        { label: 'Cheque', value: 'Cheque' },
        { label: 'Cash', value: 'Cash' },
        { label: 'Bank Transfer', value: 'Bank Transfer' },
        { label: 'Wire Transfer', value: 'Wire Transfer' }
    ];
    purposeOptions = [
        { label: 'Downpayment', value: 'Downpayment' },
        { label: 'Installment', value: 'Installment' },
        { label: 'Fees', value: 'Fees' }
    ];
    bankNameOptions = [
        { label: 'Emirates NBD', value: 'Emirates NBD' },
        { label: 'ADCB', value: 'ADCB' },
        { label: 'FAB', value: 'FAB' },
        { label: 'DIB', value: 'DIB' }
    ];

    /* ============ STEP GETTERS ============ */
    get isStep1() { return this.currentStep === 1; }
    get isStep2() { return this.currentStep === 2; }
    get isStep3() { return this.currentStep === 3; }
    get isStep4() { return this.currentStep === 4; }

    get step1Class() { return 'step ' + (this.currentStep >= 1 ? 'active' : ''); }
    get step2Class() { return 'step ' + (this.currentStep >= 2 ? 'active' : ''); }
    get step3Class() { return 'step ' + (this.currentStep >= 3 ? 'active' : ''); }
    get step4Class() { return 'step ' + (this.currentStep >= 4 ? 'active' : ''); }

    get hasInventoryUnits()   { return this.inventoryUnits.length > 0; }
    get noInventoryUnitsFound() {
        return !this.isInventoryLoading && this.inventoryUnits.length === 0 && !this.inventoryError;
    }
    get noPaymentPlansFound() {
        return !this.isInventoryLoading && this.paymentPlanDetails.length === 0;
    }
    get disableCreateBookingsButton() {
        return this.isInventoryLoading || this.selectedInventoryIds.length === 0;
    }
    get hasJointOwners()     { return this.jointOwners.length > 0; }

    @wire(getRecord, { recordId: '$recordId', fields: [OPPORTUNITY_NAME] })
    opportunity;

    get bookingName() {
        return getFieldValue(this.opportunity.data, OPPORTUNITY_NAME) || '';
    }

    /* ============ LOAD ACCOUNT & OPPORTUNITY FIELD SETS (STEP 1) ============ */
    @wire(getAccountAndOpportunity, {
        opportunityId: '$recordId',
        accountFieldSet: 'BookUnitAccountFields',
        opportunityFieldSet: 'Book_Unit_Opp_Fields'
    })
    wiredAccountOpp({ data, error }) {
        if (data) {
            this.accountId       = data.accountData?.Id;
            this.accountFields   = data.accountFields.filter(f => f !== 'Id');
            this.opportunityFields = data.opportunityFields.filter(f => f !== 'Id');
            this.loadInventoryUnits();
        } else if (error) {
            console.error(error);
            this.showToast('Error', 'Failed to load account/opportunity data', 'error');
        }
    }

    get opportunityFieldObjects() {
        return this.opportunityFields.map(f => ({
            name: f,
            disabled: f === 'AccountId'
        }));
    }

    /* ============ STEP 1 SAVE ============ */
    handleStep1Save() {
        this.isStep1Loading = true;
        this.accountSaved = false;
        this.opportunitySaved = false;

        const accountForm = this.template.querySelector('lightning-record-edit-form[data-type="account"]');
        const oppForm     = this.template.querySelector('lightning-record-edit-form[data-type="opportunity"]');

        if (accountForm) accountForm.submit();
        if (oppForm)     oppForm.submit();
    }

    handleAccountSave() {
        this.accountSaved = true;
        this.checkStep1AllSaved();
    }

    handleOpportunitySave() {
        this.opportunitySaved = true;
        this.checkStep1AllSaved();
    }

    checkStep1AllSaved() {
        if (this.accountSaved && this.opportunitySaved) {
            this.isStep1Loading = false;
            this.showToast('Success', 'Account and Opportunity saved successfully!', 'success');
            this.currentStep = 2;
        }
    }

    handleFormError(event) {
        this.isStep1Loading = false;
        const message = event.detail?.detail || 'Unknown error';
        this.showToast('Error', 'Error saving records: ' + message, 'error');
    }

    /* ============ MODE GETTERS ============ */
    get isCheque()       { return this.paymentMode === 'Cheque'; }
    get bankName()       { return this.payFields.bankName; }

    /* ============ LOAD INVENTORY UNITS (STEP 2) ============ */
    loadInventoryUnits() {
        if (!this.accountId) {
            this.inventoryUnits = [];
            return;
        }
        this.isInventoryLoading = true;
        this.inventoryError = undefined;

        getInventoryUnits({ accountId: this.accountId })
            .then(data => {
                this.inventoryUnits = data;
                this.inventoryError = undefined;
            })
            .catch(error => {
                this.inventoryError = error;
                this.inventoryUnits = [];
                const msg = error?.body?.message || 'Failed to load inventory units';
                this.showToast('Error Loading Units', msg, 'error');
            })
            .finally(() => {
                this.isInventoryLoading = false;
            });
    }

    handleInventoryRowSelection(event) {
        const selectedRows = event.detail?.selectedRows || [];
        if (selectedRows.length > 10) {
            this.showToast('Selection Limit Exceeded', 'You can only select a maximum of 10 units at a time.', 'error');

            // Revert selection in the datatable UI
            const datatable = this.template.querySelector('lightning-datatable[data-id="inventory-table"]');
            if (datatable) datatable.selectedRows = [...this.selectedInventoryIds];

            return;
        }
        this.selectedInventoryIds = selectedRows.map(row => row.Id);
    }

    handleCreateBookings() {
        if (this.selectedInventoryIds.length === 0) {
            this.showToast('Warning', 'Please select at least one inventory unit.', 'warning');
            return;
        }

        this.isInventoryLoading = true;
        this.inventoryError = undefined;

        createBookingUnits({
            opportunityId: this.recordId,
            selectedInventoryIds: this.selectedInventoryIds
        })
            .then(result => {
                this.showToast('Success', result, 'success');
                return getPaymentPlanDetails({ selectedInventoryIds: this.selectedInventoryIds });
            })
            .then(ppdResult => {
                this.paymentPlanDetails = ppdResult.map(row => ({
                    ...row,
                    percentDisplay: row.Percent__c / 100
                }));
                this.showInventorySelection = false;
                this.isInventoryLoading = false;
            })
            .catch(error => {
                this.isInventoryLoading = false;
                this.inventoryError = error;
                const msg = error?.body?.message || 'Something went wrong while creating bookings';
                this.showToast('Error', msg, 'error');
            });
    }

    handleBackToInventorySelection() {
        this.showInventorySelection = true;
    }

    /* ============ JOINT OWNER HANDLERS ============ */
    handleAddJointOwner() {
        this.jointOwners = [
            ...this.jointOwners,
            {
                id: this.nextJointOwnerId++,
                accountId: null,
                accountName: '',
                searchTerm: '',
                searchResults: [],
                showDropdown: false,
                isSearching: false,
                _searchTimer: null,
                share: null
            }
        ];
    }

    handleJointOwnerChange(event) {
        const index = Number(event.currentTarget.dataset.index);
        const field = event.currentTarget.dataset.field;
        const value = event.detail.value;
        this.jointOwners = this.jointOwners.map((owner, ownerIndex) =>
            ownerIndex === index ? { ...owner, [field]: value } : owner
        );
    }

    handleRemoveJointOwner(event) {
        const ownerId = Number(event.currentTarget.dataset.id);
        this.jointOwners = this.jointOwners.filter(owner => owner.id !== ownerId);
    }

    /* ---- custom account lookup ---- */
    handleAccountSearch(event) {
        const index = Number(event.currentTarget.dataset.index);
        const term = event.target.value;

        this.jointOwners = this.jointOwners.map((o, i) =>
            i === index ? { ...o, searchTerm: term, showDropdown: true, isSearching: true, searchResults: [] } : o
        );

        const owner = this.jointOwners[index];
        if (owner._searchTimer) clearTimeout(owner._searchTimer);

        const timer = setTimeout(() => {
            if (!term || term.trim().length < 1) {
                this.jointOwners = this.jointOwners.map((o, i) =>
                    i === index ? { ...o, isSearching: false, searchResults: [], showDropdown: false } : o
                );
                return;
            }
            searchAccounts({ searchTerm: term })
                .then(results => {
                    this.jointOwners = this.jointOwners.map((o, i) =>
                        i === index ? { ...o, searchResults: results, isSearching: false, showDropdown: true } : o
                    );
                })
                .catch(() => {
                    this.jointOwners = this.jointOwners.map((o, i) =>
                        i === index ? { ...o, isSearching: false, searchResults: [] } : o
                    );
                });
        }, 300);

        this.jointOwners = this.jointOwners.map((o, i) =>
            i === index ? { ...o, _searchTimer: timer } : o
        );
    }

    handleAccountSearchFocus(event) {
        const index = Number(event.currentTarget.dataset.index);
        const owner = this.jointOwners[index];
        if (owner.searchResults && owner.searchResults.length > 0) {
            this.jointOwners = this.jointOwners.map((o, i) =>
                i === index ? { ...o, showDropdown: true } : o
            );
        }
    }

    handleAccountSearchBlur(event) {
        const index = Number(event.currentTarget.dataset.index);
        setTimeout(() => {
            this.jointOwners = this.jointOwners.map((o, i) =>
                i === index ? { ...o, showDropdown: false } : o
            );
        }, 200);
    }

    handleAccountSelect(event) {
        const index = Number(event.currentTarget.dataset.index);
        const id   = event.currentTarget.dataset.id;
        const name = event.currentTarget.dataset.name;
        this.jointOwners = this.jointOwners.map((o, i) =>
            i === index ? { ...o, accountId: id, accountName: name, searchTerm: '', searchResults: [], showDropdown: false } : o
        );
    }

    handleClearAccount(event) {
        const index = Number(event.currentTarget.dataset.index);
        this.jointOwners = this.jointOwners.map((o, i) =>
            i === index ? { ...o, accountId: null, accountName: '', searchTerm: '', searchResults: [], showDropdown: false } : o
        );
    }

    /* ============ NEW ACCOUNT MODAL HANDLERS ============ */
    handleOpenNewAccountModal(event) {
        this.newAccountOwnerIndex = Number(event.currentTarget.dataset.index);
        this.newAccount = { firstName: '', lastName: '', phone: '', email: '' };
        this.showNewAccountModal = true;
    }

    handleCloseNewAccountModal() {
        this.showNewAccountModal = false;
        this.newAccountOwnerIndex = null;
        this.isCreatingAccount = false;
    }

    handleNewAccountFieldChange(event) {
        const field = event.target.dataset.field;
        this.newAccount = { ...this.newAccount, [field]: event.detail.value };
    }

    handleCreateNewAccount() {
        const { firstName, lastName, phone } = this.newAccount;
        if (!lastName || !lastName.trim()) {
            this.showToast('Error', 'Last Name is required to create an Account', 'error');
            return;
        }
        this.isCreatingAccount = true;

        const fullName = firstName ? `${firstName.trim()} ${lastName.trim()}` : lastName.trim();
        const fields = {};
        fields[ACCOUNT_NAME_FIELD.fieldApiName] = fullName;
        if (phone) fields[ACCOUNT_PHONE_FIELD.fieldApiName] = phone;

        createRecord({ apiName: ACCOUNT_OBJECT.objectApiName, fields })
            .then(account => {
                const newId = account.id;
                const idx   = this.newAccountOwnerIndex;
                this.jointOwners = this.jointOwners.map((owner, ownerIndex) =>
                    ownerIndex === idx
                        ? { ...owner, accountId: newId, accountName: fullName, searchTerm: '', searchResults: [], showDropdown: false }
                        : owner
                );
                this.isCreatingAccount = false;
                this.showNewAccountModal = false;
                this.newAccountOwnerIndex = null;
                this.showToast('Success', `Account "${fullName}" created and selected`, 'success');
            })
            .catch(error => {
                this.isCreatingAccount = false;
                const msg = error?.body?.message || 'Failed to create Account';
                this.showToast('Error', msg, 'error');
            });
    }

    /* ============ STEP NAV ============ */
    handleNext() {
        if (this.currentStep === 2) {
            if (this.selectedInventoryIds.length === 0 || this.showInventorySelection) {
                this.showToast('Error', 'Please select inventory unit(s) and click Create Bookings before continuing', 'error');
                return;
            }
        } else if (this.currentStep === 3) {
            for (let i = 0; i < this.jointOwners.length; i++) {
                const owner = this.jointOwners[i];
                const share = Number(owner.share);
                if (!owner.accountId || owner.share === null || owner.share === '' ||
                    !Number.isFinite(share) || share <= 0 || share > 100) {
                    this.showToast(
                        'Error',
                        `Select an Account and enter a Share % between 0 and 100 for Joint Owner ${i + 1}`,
                        'error'
                    );
                    return;
                }
            }
        }
        this.currentStep++;
    }

    handleBack() {
        this.currentStep--;
    }

    /* ============ PAYMENT FIELD HANDLERS ============ */
    handlePaymentModeChange(event) {
        this.paymentMode = event.detail.value;
        this.payFields = {};
    }

    handleFieldChange(event) {
        const field = event.target.dataset.field;
        const value = event.detail.value;
        if (field === 'purpose') {
            this.purpose = value;
        } else if (field === 'amount') {
            this.amount = value;
        } else {
            this.payFields = { ...this.payFields, [field]: value };
        }
    }

    /* ============ SAVE ============ */
    handleSave() {
        if (!this.paymentMode || !this.amount) {
            this.showToast('Error', 'Please enter Payment Mode and Amount', 'error');
            return;
        }
        this.isSaving = true;

        const jointOwnerPayload = this.jointOwners.map(owner => ({
            Account__c:     owner.accountId,
            Share__c:       Number(owner.share),
            Booking__c:     this.recordId
        }));

        const promises = [
            createUnitPayment({
                opportunityId: this.recordId,
                paymentMode:   this.paymentMode,
                purpose:       this.purpose,
                amount:        this.amount,
                fieldsJson:    JSON.stringify(this.payFields)
            })
        ];

        if (jointOwnerPayload.length > 0) {
            promises.push(createJointOwners({ jointOwners: jointOwnerPayload }));
        }

        Promise.all(promises)
            .then(() => {
                this.isSaving = false;
                this.showToast('Success', 'Booking & Payment created successfully', 'success');
                this.dispatchEvent(new CloseActionScreenEvent());
            })
            .catch(error => {
                this.isSaving = false;
                console.error(error);
                const msg = error?.body?.message || 'Something went wrong';
                this.showToast('Error', msg, 'error');
            });
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}