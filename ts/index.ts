import * as events from "events";
import * as _ from 'lodash';
import * as asg from 'autoscalable-grid';

export type WorkerKey = string; // worker key used to terminate/launch worker, actual implementation decide what this is

export interface IWorkersLaunchRequest {
    NumInstance: number;
    Hint?: any;
}

export interface IAutoScalerImplementation {
    TranslateToWorkerKeys: (workers: asg.IWorker[]) => Promise<WorkerKey[]>;     // translate from IWorker to WorkerKey
    ComputeWorkersLaunchRequest: (state: asg.IAutoScalableState) => Promise<IWorkersLaunchRequest>;  // calculate the number of additional workers desired given the current state of the autoscalable
    LaunchInstances: (launchRequest: IWorkersLaunchRequest) => Promise<WorkerKey[]>;                // actual implementation of launching new workers
    TerminateInstances: (workers: asg.IWorker[]) => Promise<WorkerKey[]>;                          // actual implementation of terminating the workers
    getConfigUrl:  () => Promise<string>;                                                           // configuration url for the actual implementation
}

export interface Options {
    EnabledAtStart?: boolean;
    MaxAllowedWorkers?: number;
    PollingIntervalMS?: number;
    TerminateWorkerAfterMinutesIdle?: number;
}

let defaultOptions: Options = {
    EnabledAtStart: false
    ,PollingIntervalMS: 1000
    ,TerminateWorkerAfterMinutesIdle: 5
};

interface TimerFunction {
    () : void
}

export interface IGridAutoScalerJSON {
    Scaling: boolean;
    Enabled: boolean;
    HasWorkersCap: boolean;
    MaxAllowedWorkers: number;
    LaunchingWorkers: WorkerKey[];
    TerminatingWorkers: WorkerKey[];
}

export interface IGridAutoScaler {
    isScaling: () => Promise<boolean>;
    isEnabled: () => Promise<boolean>;
    hasWorkersCap: () => Promise<boolean>;
    enable: () => Promise<any>;
    disable: () => Promise<any>;
    getMaxAllowedWorkers: () => Promise<number>;
    setMaxAllowedWorkers: (value: number) => Promise<any>;
    getLaunchingWorkers: () => Promise<WorkerKey[]>;
    getTerminatingWorkers: () => Promise<WorkerKey[]>;
    getJSON: () => Promise<IGridAutoScalerJSON>;
    getImplementationConfigUrl: () => Promise<string>;
}

// the class supported the following events:
// 1. polling
// 2. scalable-state (IAutoScalableState)
// 3. error (error: any)
// 4. change
// 5. down-scaling (workers: IWorker[])
// 6. up-scaling (numInstances: number)
// 7. down-scaled (workerKeys: WorkerKey[])
// 8. up-scaled (workerKeys: WorkerKey[])
export class GridAutoScaler extends events.EventEmitter {
    private options: Options = null;
    private __enabled: boolean;
    private __MaxAllowedWorkers: number;
    private __terminatingWorkers: {[workerKey: string]: boolean};
    private __launchingWorkers: {[workerKey: string]: boolean};
    constructor(private scalableGrid: asg.IAutoScalableGrid, private implementation: IAutoScalerImplementation, options?: Options) {
        super();
        this.__terminatingWorkers = null;
        this.__launchingWorkers = null;
        options = options || defaultOptions;
        this.options = _.assignIn({}, defaultOptions, options);
        this.__enabled = this.options.EnabledAtStart;
        this.__MaxAllowedWorkers = this.options.MaxAllowedWorkers;
        this.TimerFunction.apply(this);
    }
    get Scaling() : boolean {return (this.__terminatingWorkers !== null || this.__launchingWorkers !== null);}
    get LaunchingWorkers() : WorkerKey[] {
        if (this.__launchingWorkers) {
            let workers: WorkerKey[] = [];
            for (let workerKey in this.__launchingWorkers)
                workers.push(workerKey);
            return workers;
        } else
            return [];
    }
    get TerminatingWorkers() : WorkerKey[] {
        if (this.__terminatingWorkers) {
            let workers: WorkerKey[] = [];
            for (let workerKey in this.__terminatingWorkers)
                workers.push(workerKey);
            return workers;
        } else
            return [];
    }

    get Enabled() :boolean {return this.__enabled;}
    set Enabled(newValue: boolean) {
        if (newValue !== this.__enabled) {
            this.__enabled = newValue;
            this.emit('change');
        }
    }
    get HasWorkersCap() : boolean {return (typeof this.__MaxAllowedWorkers === 'number' && this.__MaxAllowedWorkers > 0)}
    get MaxAllowedWorkers() : number {return this.__MaxAllowedWorkers;}
    set MaxAllowedWorkers(newValue: number) {
        if (newValue !== this.__MaxAllowedWorkers) {
            this.__MaxAllowedWorkers = newValue;
            this.emit('change');
        }
    }

    private getWorkerFromState(state: asg.IWorkerState) : asg.IWorker {
        return {
            Id: state.Id
            ,Name: state.Name
            ,RemoteAddress: state.RemoteAddress
            ,RemotePort: state.RemotePort
        };
    }

    // down-scaling logic
    private getDownScalingPromise(state: asg.IAutoScalableState) : Promise<WorkerKey[]> {
        if (state.QueueEmpty) {   // queue is empty
            let toBeTerminatedWorkers: asg.IWorker[]  = [];
            for (let i in state.WorkerStates) {
                let ws = state.WorkerStates[i];
                if (!ws.Busy && typeof ws.LastIdleTime === 'number') {
                    let elapseMS = state.CurrentTime - ws.LastIdleTime;
                    if (elapseMS > this.options.TerminateWorkerAfterMinutesIdle * 60 * 1000)
                        toBeTerminatedWorkers.push(this.getWorkerFromState(ws));
                }
            }
            if (toBeTerminatedWorkers.length > 0) {
                this.emit('down-scaling', toBeTerminatedWorkers);
                return this.implementation.TerminateInstances(toBeTerminatedWorkers);
            } else  // no worker is idle long enough => nothing to terminate
                return Promise.resolve<any>(null);
        } else  // queue is not empty => nothing to terminate
            return Promise.resolve<any>(null);
    }

    private getUpScalingWithTaskDebtPromise(state: asg.IAutoScalableState) : Promise<WorkerKey[]> {
        return new Promise<WorkerKey[]>((resolve:(value: WorkerKey[]) => void, reject: (err: any) => void) => {
            this.implementation.ComputeWorkersLaunchRequest(state)    // compute the number of additional workers desired
            .then((launchRequest: IWorkersLaunchRequest) => {
                let numWorkersToLaunch = 0;
                if (this.HasWorkersCap) {
                    let workersAllowance = Math.max(this.MaxAllowedWorkers - state.WorkerStates.length, 0);    // number of workers stlll allowed to be launched under the cap
                    numWorkersToLaunch = Math.min(launchRequest.NumInstance, workersAllowance);
                } else    // no workers cap
                    numWorkersToLaunch = launchRequest.NumInstance;
                if (numWorkersToLaunch > 0) {
                    this.emit('up-scaling', numWorkersToLaunch);
                    this.implementation.LaunchInstances({NumInstance: numWorkersToLaunch, Hint: launchRequest.Hint})
                    .then((workerKeys: WorkerKey[]) => {
                        resolve(workerKeys);
                    }).catch((err: any) => {
                        reject(err);
                    })
                } else // nothing to launch
                    resolve(null);
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    // up-scaling logic
    private getUpScalingPromise(state: asg.IAutoScalableState) : Promise<WorkerKey[]> {
        if (!state.QueueEmpty) {  // queue is not empty
            if (state.CPUDebt > 0)  // has cpu shortage
                return this.getUpScalingWithTaskDebtPromise(state);
            else  // no cpu shortage => nothing to launch
                return Promise.resolve<any>(null);
        } else  // no task in queue => nothing to launch
            return Promise.resolve<any>(null);
    }

    private feedLastestWorkerStates(workerStates: asg.IWorkerState[]) : Promise<any> {
        return new Promise<any>((resolve:(value: any) => void, reject: (err: any) => void) => {
            let workers: asg.IWorker[] = [];
            for (let i in workerStates) {
                let ws = workerStates[i];
                workers.push(this.getWorkerFromState(ws));
            }
            this.implementation.TranslateToWorkerKeys(workers)
            .then((workerKeys: WorkerKey[]) => {
                let currentWorkers: {[workerKey: string] : boolean} = {};
                for (let i in workerKeys) {
                    let workerKey = workerKeys[i];
                    currentWorkers[workerKey] = true;
                }
                let oldScaling = this.Scaling;

                if (this.__terminatingWorkers) {
                    let workers = this.TerminatingWorkers;
                    for (let i in workers) {    // check each terminating worker
                        let workerKey = workers[i];
                        if (!currentWorkers[workerKey]) // worker is indeed terminated
                            delete this.__terminatingWorkers[workerKey];
                    }
                    if (_.isEmpty(this.__terminatingWorkers)) this.__terminatingWorkers = null;
                }

                if (this.__launchingWorkers) {
                    let workers = this.LaunchingWorkers;
                    for (let i in workers) {    // check each launching worker
                        let workerKey = workers[i];
                        if (currentWorkers[workerKey]) // worker is indeed launched
                            delete this.__launchingWorkers[workerKey];
                    }
                    if (_.isEmpty(this.__launchingWorkers)) this.__launchingWorkers = null;
                }

                if (this.Scaling != oldScaling)
                    this.emit('change');

                resolve({});
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    private get AutoScalingPromise() : Promise<boolean> {
        return new Promise<boolean>((resolve:(value: boolean) => void, reject: (err: any) => void) => {
            let state: asg.IAutoScalableState = null;
            this.scalableGrid.getCurrentState()  // get the current state of the scalable
            .then((st: asg.IAutoScalableState) => {
                state = st;
                this.emit('scalable-state', state);
                return this.feedLastestWorkerStates(state.WorkerStates);
            }).then(() => {
                if (this.Enabled && !this.Scaling)  // enabled and currently not performing scaling
                    return Promise.all([this.getDownScalingPromise(state), this.getUpScalingPromise(state)])
                else
                    return Promise.resolve<[WorkerKey[], WorkerKey[]]>([null, null]);
            }).then((value: [WorkerKey[], WorkerKey[]]) => {
                let oldScaling = this.Scaling;
                let terminateWorkerKeys = value[0];
                if (terminateWorkerKeys != null && terminateWorkerKeys.length > 0) {
                    this.__terminatingWorkers = {};
                    for (let i in terminateWorkerKeys) {
                        let workerKey = terminateWorkerKeys[i];
                        this.__terminatingWorkers[workerKey] = true;
                    }
                    this.emit('down-scaled', terminateWorkerKeys);
                }
                let launchWorkerKeys = value[1];
                if (launchWorkerKeys != null && launchWorkerKeys.length > 0) {
                    this.__launchingWorkers = {};
                    for (let i in launchWorkerKeys) {
                        let workerKey = launchWorkerKeys[i];
                        this.__launchingWorkers[workerKey] = true;
                    }
                    this.emit('up-scaled', launchWorkerKeys);
                }
                if (this.Scaling != oldScaling)
                    this.emit('change');
                let scalingTriggered = (terminateWorkerKeys !== null || launchWorkerKeys !== null);
                resolve(scalingTriggered);
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    private get TimerFunction() : TimerFunction {
        let func = () => {
            this.emit('polling');
            this.AutoScalingPromise
            .then((scalingTriggered: boolean) => {
                setTimeout(this.TimerFunction, this.options.PollingIntervalMS);
            }).catch((err:any) => {
                this.emit('error', err);
                setTimeout(this.TimerFunction, this.options.PollingIntervalMS);
            });
        };
        return func.bind(this);
    }

    get ImplementationConfigUrl(): Promise<string> {return this.implementation.getConfigUrl();}

    toJSON() : IGridAutoScalerJSON {
        return {
            Enabled: this.Enabled
            ,Scaling: this.Scaling
            ,HasWorkersCap: this.HasWorkersCap
            ,MaxAllowedWorkers: this.MaxAllowedWorkers
            ,LaunchingWorkers: this.LaunchingWorkers
            ,TerminatingWorkers: this.TerminatingWorkers
        };
    }
}