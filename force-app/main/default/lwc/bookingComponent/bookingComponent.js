import { LightningElement, api, wire } from 'lwc';
import getProjects from '@salesforce/apex/BookingController.getProjects';
import getProperties from '@salesforce/apex/BookingController.getProperties';
import getUnits from '@salesforce/apex/BookingController.getUnits';
import createBookingUnit from '@salesforce/apex/BookingController.createBookingUnit';
import createUnitPayment from '@salesforce/apex/BookingController.createUnitPayment';
import createJointOwners from '@salesforce/apex/BookingController.createJointOwners';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { CloseActionScreenEvent } from 'lightning/actions';
import { getRecord, getFieldValue, createRecord } from 'lightning/uiRecordApi';
import ACCOUNT_OBJECT from '@salesforce/schema/Account';
import ACCOUNT_NAME_FIELD from '@salesforce/schema/Account.Name';
import ACCOUNT_PHONE_FIELD from '@salesforce/schema/Account.Phone';
import OPPORTUNITY_NAME from '@salesforce/schema/Opportunity.Name';

const DUMMY_WIRE_URL = 'https://infobeanscloudtechlimited60-dev-ed.develop.my.site.com/paymentgetway';

export default class BookingComponent extends LightningElement {
    @api recordId; // Opportunity Id

    // step control
    currentStep = 1;

    // booking
    projectId;
    propertyId;
    unitId;
    projectOptions = [];
    propertyOptions = [];
    unitOptions = [];
    selectedUnitInfo;
    unitCost;
    bookingUnitId;

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
    cardTypeOptions = [
        { label: 'Visa', value: 'Visa' },
        { label: 'Mastercard', value: 'Mastercard' },
        { label: 'Amex', value: 'Amex' }
    ];
    bankNameOptions = [
        { label: 'Emirates NBD', value: 'Emirates NBD' },
        { label: 'ADCB', value: 'ADCB' },
        { label: 'FAB', value: 'FAB' },
        { label: 'DIB', value: 'DIB' }
    ];
    chequeStatusOptions = [
        { label: 'Held', value: 'Held' },
        { label: 'Deposited', value: 'Deposited' },
        { label: 'Cleared', value: 'Cleared' },
        { label: 'Bounced', value: 'Bounced' },
        { label: 'Returned', value: 'Returned' }
    ];
    installmentOptions = [
        { label: '1', value: '1' },
        { label: '3', value: '3' },
        { label: '6', value: '6' },
        { label: '12', value: '12' }
    ];

    /* ============ STEP GETTERS ============ */
    get isStep1() { return this.currentStep === 1; }
    get isStep2() { return this.currentStep === 2; }
    get isStep3() { return this.currentStep === 3; }

    get step1Class() {
        return 'step ' + (this.currentStep >= 1 ? 'active' : '');
    }
    get step2Class() {
        return 'step ' + (this.currentStep >= 2 ? 'active' : '');
    }
    get step3Class() {
        return 'step ' + (this.currentStep >= 3 ? 'active' : '');
    }

    get isPropertyDisabled() { return !this.projectId; }
    get isUnitDisabled() { return !this.propertyId; }
    get hasJointOwners() { return this.jointOwners.length > 0; }

    @wire(getRecord, { recordId: '$recordId', fields: [OPPORTUNITY_NAME] })
    opportunity;

    get bookingName() {
        return getFieldValue(this.opportunity.data, OPPORTUNITY_NAME) || '';
    }

    /* ============ MODE GETTERS ============ */
    get isCreditCard() { return this.paymentMode === 'Credit Card'; }
    get isCheque() { return this.paymentMode === 'Cheque'; }
    get isCash() { return this.paymentMode === 'Cash'; }
    get isBankTransfer() { return this.paymentMode === 'Bank Transfer'; }
    get isWireTransfer() { return this.paymentMode === 'Wire Transfer'; }

    // bound to template picklists for value persistence
    get cardType() { return this.payFields.cardType; }
    get installments() { return this.payFields.installments; }
    get bankName() { return this.payFields.bankName; }
    get chequeStatus() { return this.payFields.chequeStatus; }

    get formattedUnitCost() {
        if (this.unitCost == null) return '';
        return new Intl.NumberFormat('en-AE', {
            style: 'currency', currency: 'AED'
        }).format(this.unitCost);
    }

    /* ============ LOAD PROJECTS ============ */
    @wire(getProjects)
    wiredProjects({ data, error }) {
        if (data) {
            this.projectOptions = data.map(p => ({ label: p.Name, value: p.Id }));
        } else if (error) {
            console.error(error);
        }
    }

    handleProjectChange(event) {
        this.projectId = event.detail.value;
        this.propertyId = null;
        this.unitId = null;
        this.propertyOptions = [];
        this.unitOptions = [];
        this.selectedUnitInfo = null;
        getProperties({ projectId: this.projectId })
            .then(result => {
                this.propertyOptions = result.map(p => ({ label: p.Name, value: p.Id }));
            })
            .catch(error => console.error(error));
    }

    handlePropertyChange(event) {
        this.propertyId = event.detail.value;
        this.unitId = null;
        this.unitOptions = [];
        this.selectedUnitInfo = null;
        getUnits({ propertyId: this.propertyId })
            .then(result => {
                this._units = result;
                this.unitOptions = result.map(u => ({ label: u.Name, value: u.Id }));
            })
            .catch(error => console.error(error));
    }

    handleUnitChange(event) {
        this.unitId = event.detail.value;
        const u = (this._units || []).find(x => x.Id === this.unitId);
        if (u) {
            this.selectedUnitInfo = true;
            this.unitCost = u.Unit_Cost__c;
        }
    }

    /* ============ JOINT OWNER HANDLERS ============ */
    handleAddJointOwner() {
        this.jointOwners = [
            ...this.jointOwners,
            {
                id: this.nextJointOwnerId++,
                accountId: null,
                share: null
            }
        ];
    }

    handleJointOwnerChange(event) {
        const index = Number(event.currentTarget.dataset.index);
        const field = event.currentTarget.dataset.field;
        const value = field === 'accountId' ? event.detail.recordId : event.detail.value;

        this.jointOwners = this.jointOwners.map((owner, ownerIndex) =>
            ownerIndex === index ? { ...owner, [field]: value } : owner
        );
    }

    handleRemoveJointOwner(event) {
        const ownerId = Number(event.currentTarget.dataset.id);
        this.jointOwners = this.jointOwners.filter(owner => owner.id !== ownerId);
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
        const { firstName, lastName, phone, email } = this.newAccount;
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
                const idx = this.newAccountOwnerIndex;

                // Auto-select the newly created account in the correct owner row
                this.jointOwners = this.jointOwners.map((owner, ownerIndex) =>
                    ownerIndex === idx ? { ...owner, accountId: newId } : owner
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
        if (this.currentStep === 1) {
            if (!this.projectId || !this.propertyId || !this.unitId) {
                this.showToast('Error', 'Please select Project, Property and Unit', 'error');
                return;
            }
        } else if (this.currentStep === 2) {
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
        // clear mode-specific fields when switching
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

        createBookingUnit({
            opportunityId: this.recordId,
            projectId: this.projectId,
            propertyId: this.propertyId,
            unitId: this.unitId
        })
        .then(bookingId => {
            this.bookingUnitId = bookingId;
            const jointOwnerPayload = this.jointOwners.map(owner => ({
                Account__c: owner.accountId,
                Share__c: Number(owner.share),
                Booking__c: this.recordId,
                Booking_Unit__c: this.bookingUnitId
            }));

            const promises = [
                createUnitPayment({
                    opportunityId: this.recordId,
                    unitId: this.unitId,
                    projectId: this.projectId,
                    paymentMode: this.paymentMode,
                    purpose: this.purpose,
                    amount: this.amount,
                    fieldsJson: JSON.stringify(this.payFields)
                })
            ];

            if (jointOwnerPayload.length > 0) {
                promises.push(createJointOwners({ jointOwners: jointOwnerPayload }));
            }

            return Promise.all(promises);
        })
        .then(([paymentResult]) => {
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